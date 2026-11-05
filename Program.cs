using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using MySqlConnector;

var appDirectory = AppContext.BaseDirectory;
var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = appDirectory,
    WebRootPath = Path.Combine(appDirectory, "FRONTEND")
});

var configuredConnectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException(
        "Configure the ConnectionStrings:Default MySQL connection string.");
var databaseName = builder.Configuration["Database:Name"] ?? "dolis";

if (!Regex.IsMatch(databaseName, "^[A-Za-z0-9_]+$"))
{
    throw new InvalidOperationException(
        "Database:Name may contain only letters, numbers, and underscores.");
}

var connectionBuilder = new MySqlConnectionStringBuilder(configuredConnectionString);
var databaseConnectionString = new MySqlConnectionStringBuilder(
    configuredConnectionString)
{
    Database = databaseName
}.ConnectionString;

builder.Services.AddSingleton(new Database(databaseConnectionString));

var app = builder.Build();

await InitializeDatabaseAsync(connectionBuilder, databaseName);

app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await Results.Problem(
            title: "An unexpected server error occurred.",
            statusCode: StatusCodes.Status500InternalServerError)
            .ExecuteAsync(context);
    });
});

app.UseStaticFiles();

app.MapGet("/", () => Results.Redirect("/HTML/login.html"));
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.MapPost("/api/auth/register", async (
    RegisterRequest request,
    Database database,
    HttpContext context) =>
{
    var fullName = request.FullName?.Trim();
    var email = NormalizeEmail(request.Email);
    var password = request.Password;

    if (string.IsNullOrWhiteSpace(fullName) || fullName.Length > 100)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["fullName"] = ["Enter a name between 1 and 100 characters."]
        });
    }

    if (!IsValidEmail(email))
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["email"] = ["Enter a valid email address."]
        });
    }

    if (password is null || password.Length < 8 || password.Length > 128)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["password"] = ["Password must be between 8 and 128 characters."]
        });
    }

    var userId = Guid.NewGuid();
    var passwordHash = PasswordHasher.Hash(password);
    var sessionToken = CreateSessionToken();
    var expiresAt = DateTime.UtcNow.AddDays(14);

    await using var connection = await database.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    try
    {
        await using var insertUser = new MySqlCommand(
            """
            INSERT INTO users (id, full_name, email, password_hash)
            VALUES (@id, @fullName, @email, @passwordHash)
            """,
            connection,
            transaction);
        insertUser.Parameters.AddWithValue("@id", userId.ToString("D"));
        insertUser.Parameters.AddWithValue("@fullName", fullName);
        insertUser.Parameters.AddWithValue("@email", email);
        insertUser.Parameters.AddWithValue("@passwordHash", passwordHash);
        await insertUser.ExecuteNonQueryAsync();

        await InsertSessionAsync(
            connection,
            transaction,
            userId,
            sessionToken,
            expiresAt);
        await transaction.CommitAsync();
    }
    catch (MySqlException exception) when (exception.Number == 1062)
    {
        await transaction.RollbackAsync();
        return Results.Conflict(new { message = "An account with that email already exists." });
    }

    SetSessionCookie(context, sessionToken, expiresAt);
    return Results.Created(
        "/api/auth/me",
        new { id = userId, fullName, email });
});

app.MapPost("/api/auth/login", async (
    LoginRequest request,
    Database database,
    HttpContext context) =>
{
    var email = NormalizeEmail(request.Email);
    if (!IsValidEmail(email) ||
        string.IsNullOrEmpty(request.Password) ||
        request.Password.Length > 128)
    {
        return Results.Unauthorized();
    }

    await using var connection = await database.OpenConnectionAsync();
    await using var command = new MySqlCommand(
        """
        SELECT id, full_name, email, password_hash
        FROM users
        WHERE email = @email
        LIMIT 1
        """,
        connection);
    command.Parameters.AddWithValue("@email", email);

    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return Results.Unauthorized();
    }

    var userId = reader.GetGuid("id");
    var fullName = reader.GetString("full_name");
    var storedEmail = reader.GetString("email");
    var passwordHash = reader.GetString("password_hash");

    if (!PasswordHasher.Verify(request.Password, passwordHash))
    {
        return Results.Unauthorized();
    }

    await reader.CloseAsync();

    var sessionToken = CreateSessionToken();
    var expiresAt = DateTime.UtcNow.AddDays(14);
    await InsertSessionAsync(
        connection,
        transaction: null,
        userId,
        sessionToken,
        expiresAt);

    SetSessionCookie(context, sessionToken, expiresAt);
    return Results.Ok(new { id = userId, fullName, email = storedEmail });
});

app.MapGet("/api/auth/me", async (Database database, HttpContext context) =>
{
    var user = await FindAuthenticatedUserAsync(database, context);
    return user is null
        ? Results.Unauthorized()
        : Results.Ok(new { id = user.Id, fullName = user.FullName, email = user.Email });
});

app.MapPost("/api/auth/logout", async (Database database, HttpContext context) =>
{
    var token = context.Request.Cookies["dolis_session"];
    if (!string.IsNullOrEmpty(token))
    {
        await using var connection = await database.OpenConnectionAsync();
        await using var command = new MySqlCommand(
            "DELETE FROM sessions WHERE token_hash = @tokenHash",
            connection);
        command.Parameters.AddWithValue("@tokenHash", HashSessionToken(token));
        await command.ExecuteNonQueryAsync();
    }

    context.Response.Cookies.Delete("dolis_session", SessionCookieOptions(context));
    return Results.NoContent();
});

app.MapGet("/api/items", async (Database database, HttpContext context) =>
{
    var user = await FindAuthenticatedUserAsync(database, context);
    if (user is null)
    {
        return Results.Unauthorized();
    }

    var items = new List<ItemResponse>();
    await using var connection = await database.OpenConnectionAsync();
    await using var command = new MySqlCommand(
        """
        SELECT id, kind, title, details, item_date, item_time, completed
        FROM items
        WHERE user_id = @userId
        ORDER BY item_date IS NULL, item_date, created_at, id
        """,
        connection);
    command.Parameters.AddWithValue("@userId", user.Id.ToString("D"));
    await using var reader = await command.ExecuteReaderAsync();

    while (await reader.ReadAsync())
    {
        items.Add(new ItemResponse(
            reader.GetGuid("id"),
            reader.GetString("kind"),
            reader.GetString("title"),
            reader.IsDBNull(reader.GetOrdinal("details"))
                ? ""
                : reader.GetString("details"),
            reader.IsDBNull(reader.GetOrdinal("item_date"))
                ? null
                : reader.GetString("item_date"),
            reader.IsDBNull(reader.GetOrdinal("item_time"))
                ? null
                : reader.GetString("item_time"),
            reader.GetBoolean("completed")));
    }

    return Results.Ok(items);
});

app.MapPost("/api/items", async (
    ItemRequest request,
    Database database,
    HttpContext context) =>
{
    var user = await FindAuthenticatedUserAsync(database, context);
    if (user is null)
    {
        return Results.Unauthorized();
    }

    var validation = ValidateItem(request);
    if (validation is not null)
    {
        return Results.ValidationProblem(validation);
    }

    var id = Guid.NewGuid();
    await using var connection = await database.OpenConnectionAsync();
    await using var command = new MySqlCommand(
        """
        INSERT INTO items
            (id, user_id, kind, title, details, item_date, item_time, completed)
        VALUES
            (@id, @userId, @kind, @title, @details, @date, @time, @completed)
        """,
        connection);
    AddItemParameters(command, id, user.Id, request);
    await command.ExecuteNonQueryAsync();

    return Results.Created(
        $"/api/items/{id:D}",
        ToItemResponse(id, request));
});

app.MapPut("/api/items/{id:guid}", async (
    Guid id,
    ItemRequest request,
    Database database,
    HttpContext context) =>
{
    var user = await FindAuthenticatedUserAsync(database, context);
    if (user is null)
    {
        return Results.Unauthorized();
    }

    var validation = ValidateItem(request);
    if (validation is not null)
    {
        return Results.ValidationProblem(validation);
    }

    await using var connection = await database.OpenConnectionAsync();
    await using var command = new MySqlCommand(
        """
        UPDATE items
        SET kind = @kind,
            title = @title,
            details = @details,
            item_date = @date,
            item_time = @time,
            completed = @completed,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = @id AND user_id = @userId
        """,
        connection);
    AddItemParameters(command, id, user.Id, request);

    return await command.ExecuteNonQueryAsync() == 0
        ? Results.NotFound()
        : Results.Ok(ToItemResponse(id, request));
});

app.MapDelete("/api/items/{id:guid}", async (
    Guid id,
    Database database,
    HttpContext context) =>
{
    var user = await FindAuthenticatedUserAsync(database, context);
    if (user is null)
    {
        return Results.Unauthorized();
    }

    await using var connection = await database.OpenConnectionAsync();
    await using var command = new MySqlCommand(
        "DELETE FROM items WHERE id = @id AND user_id = @userId",
        connection);
    command.Parameters.AddWithValue("@id", id.ToString("D"));
    command.Parameters.AddWithValue("@userId", user.Id.ToString("D"));

    return await command.ExecuteNonQueryAsync() == 0
        ? Results.NotFound()
        : Results.NoContent();
});

app.MapFallback(() => Results.NotFound());

app.Run();

static async Task InitializeDatabaseAsync(
    MySqlConnectionStringBuilder connectionBuilder,
    string databaseName)
{
    connectionBuilder.Database = "";
    await using (var connection = new MySqlConnection(connectionBuilder.ConnectionString))
    {
        await connection.OpenAsync();
        await using var createDatabase = new MySqlCommand(
            $"CREATE DATABASE IF NOT EXISTS `{databaseName}` " +
            "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
            connection);
        await createDatabase.ExecuteNonQueryAsync();
    }

    connectionBuilder.Database = databaseName;
    await using var database = new Database(connectionBuilder.ConnectionString);
    await using var appConnection = await database.OpenConnectionAsync();
    await using var createSchema = new MySqlCommand(
        """
        CREATE TABLE IF NOT EXISTS users (
            id CHAR(36) NOT NULL PRIMARY KEY,
            full_name VARCHAR(100) NOT NULL,
            email VARCHAR(254) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB;

        CREATE TABLE IF NOT EXISTS sessions (
            token_hash CHAR(64) NOT NULL PRIMARY KEY,
            user_id CHAR(36) NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX ix_sessions_user_id (user_id),
            CONSTRAINT fk_sessions_user
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB;

        CREATE TABLE IF NOT EXISTS items (
            id CHAR(36) NOT NULL PRIMARY KEY,
            user_id CHAR(36) NOT NULL,
            kind VARCHAR(20) NOT NULL,
            title VARCHAR(200) NOT NULL,
            details TEXT NULL,
            item_date CHAR(10) NULL,
            item_time CHAR(5) NULL,
            completed BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX ix_items_user_date (user_id, item_date),
            CONSTRAINT fk_items_user
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB;
        """,
        appConnection);
    await createSchema.ExecuteNonQueryAsync();
}

static string NormalizeEmail(string? email) => email?.Trim().ToLowerInvariant() ?? "";

static bool IsValidEmail(string email) =>
    email.Length <= 254 &&
    new EmailAddressAttribute().IsValid(email);

static string CreateSessionToken() =>
    Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');

static string HashSessionToken(string token) =>
    Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

static CookieOptions SessionCookieOptions(HttpContext context) => new()
{
    HttpOnly = true,
    Secure = context.Request.IsHttps,
    SameSite = SameSiteMode.Strict,
    Path = "/"
};

static void SetSessionCookie(
    HttpContext context,
    string token,
    DateTime expiresAt)
{
    var options = SessionCookieOptions(context);
    options.Expires = new DateTimeOffset(expiresAt, TimeSpan.Zero);
    context.Response.Cookies.Append("dolis_session", token, options);
}

static async Task InsertSessionAsync(
    MySqlConnection connection,
    System.Data.Common.DbTransaction? transaction,
    Guid userId,
    string token,
    DateTime expiresAt)
{
    await using var command = new MySqlCommand(
        """
        INSERT INTO sessions (token_hash, user_id, expires_at)
        VALUES (@tokenHash, @userId, @expiresAt)
        """,
        connection,
        transaction as MySqlTransaction);
    command.Parameters.AddWithValue("@tokenHash", HashSessionToken(token));
    command.Parameters.AddWithValue("@userId", userId.ToString("D"));
    command.Parameters.AddWithValue("@expiresAt", expiresAt);
    await command.ExecuteNonQueryAsync();
}

static async Task<AuthUser?> FindAuthenticatedUserAsync(
    Database database,
    HttpContext context)
{
    var token = context.Request.Cookies["dolis_session"];
    if (string.IsNullOrEmpty(token))
    {
        return null;
    }

    await using var connection = await database.OpenConnectionAsync();
    await using var command = new MySqlCommand(
        """
        SELECT u.id, u.full_name, u.email
        FROM sessions s
        INNER JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = @tokenHash AND s.expires_at > UTC_TIMESTAMP()
        LIMIT 1
        """,
        connection);
    command.Parameters.AddWithValue("@tokenHash", HashSessionToken(token));
    await using var reader = await command.ExecuteReaderAsync();

    return await reader.ReadAsync()
        ? new AuthUser(
            reader.GetGuid("id"),
            reader.GetString("full_name"),
            reader.GetString("email"))
        : null;
}

static Dictionary<string, string[]>? ValidateItem(ItemRequest request)
{
    var errors = new Dictionary<string, string[]>();
    var allowedKinds = new[] { "note", "reminder", "task", "event", "appointment" };

    if (request.Kind is null || !allowedKinds.Contains(request.Kind))
    {
        errors["kind"] = ["Choose a valid item type."];
    }

    if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Trim().Length > 200)
    {
        errors["title"] = ["Title is required and must be 200 characters or fewer."];
    }

    if (request.Details?.Length > 5000)
    {
        errors["details"] = ["Details must be 5000 characters or fewer."];
    }

    if (request.Date is not null &&
        !DateOnly.TryParseExact(
            request.Date,
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out _))
    {
        errors["date"] = ["Date must use the YYYY-MM-DD format."];
    }

    if (request.Time is not null &&
        !TimeOnly.TryParseExact(
            request.Time,
            "HH:mm",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out _))
    {
        errors["time"] = ["Time must use the HH:MM format."];
    }

    return errors.Count == 0 ? null : errors;
}

static void AddItemParameters(
    MySqlCommand command,
    Guid id,
    Guid userId,
    ItemRequest request)
{
    command.Parameters.AddWithValue("@id", id.ToString("D"));
    command.Parameters.AddWithValue("@userId", userId.ToString("D"));
    command.Parameters.AddWithValue("@kind", request.Kind!.Trim());
    command.Parameters.AddWithValue("@title", request.Title!.Trim());
    command.Parameters.AddWithValue(
        "@details",
        string.IsNullOrEmpty(request.Details) ? DBNull.Value : request.Details);
    command.Parameters.AddWithValue(
        "@date",
        string.IsNullOrEmpty(request.Date) ? DBNull.Value : request.Date);
    command.Parameters.AddWithValue(
        "@time",
        string.IsNullOrEmpty(request.Time) ? DBNull.Value : request.Time);
    command.Parameters.AddWithValue("@completed", request.Completed);
}

static ItemResponse ToItemResponse(Guid id, ItemRequest request) =>
    new(
        id,
        request.Kind!.Trim(),
        request.Title!.Trim(),
        request.Details ?? "",
        request.Date,
        request.Time,
        request.Completed);

sealed class Database(string connectionString) : IAsyncDisposable
{
    public async Task<MySqlConnection> OpenConnectionAsync()
    {
        var connection = new MySqlConnection(connectionString);
        await connection.OpenAsync();
        return connection;
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

sealed record RegisterRequest(string? FullName, string? Email, string? Password);
sealed record LoginRequest(string? Email, string? Password);
sealed record ItemRequest(
    string? Kind,
    string? Title,
    string? Details,
    string? Date,
    string? Time,
    bool Completed);
sealed record ItemResponse(
    Guid Id,
    string Kind,
    string Title,
    string Details,
    string? Date,
    string? Time,
    bool Completed);
sealed record AuthUser(Guid Id, string FullName, string Email);

static class PasswordHasher
{
    private const int Iterations = 310_000;
    private const int SaltSize = 16;
    private const int HashSize = 32;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Rfc2898DeriveBytes.Pbkdf2(
            password,
            salt,
            Iterations,
            HashAlgorithmName.SHA256,
            HashSize);

        return string.Join(
            '$',
            "pbkdf2-sha256",
            Iterations.ToString(CultureInfo.InvariantCulture),
            Convert.ToBase64String(salt),
            Convert.ToBase64String(hash));
    }

    public static bool Verify(string password, string storedHash)
    {
        var parts = storedHash.Split('$');
        if (parts.Length != 4 ||
            parts[0] != "pbkdf2-sha256" ||
            !int.TryParse(parts[1], out var iterations) ||
            iterations < 100_000 ||
            iterations > 1_000_000)
        {
            return false;
        }

        try
        {
            var salt = Convert.FromBase64String(parts[2]);
            var expectedHash = Convert.FromBase64String(parts[3]);
            var actualHash = Rfc2898DeriveBytes.Pbkdf2(
                password,
                salt,
                iterations,
                HashAlgorithmName.SHA256,
                expectedHash.Length);

            return CryptographicOperations.FixedTimeEquals(
                actualHash,
                expectedHash);
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
