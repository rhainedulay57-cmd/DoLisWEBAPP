function showMessage(message) {
    const messageElement = document.getElementById("message");
    if (messageElement) {
        messageElement.textContent = message;
    }
}

async function submitAuthRequest(path, payload) {
    const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        let message = response.status === 401
            ? "Email or password is incorrect."
            : "Could not complete the request.";

        try {
            const result = await response.json();
            message = result.message || result.detail || result.title ||
                (result.errors
                    ? Object.values(result.errors).flat().join(" ")
                    : message);
        } catch (error) {
            if (response.status !== 401) {
                console.error("Could not read the authentication error.", error);
            }
        }

        throw new Error(message);
    }
}

function setFormBusy(form, busy) {
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
        submitButton.disabled = busy;
    }
}

function rememberAccount(email) {
    try {
        const savedAccounts = JSON.parse(
            localStorage.getItem("dolisAccounts") || "[]"
        );
        const accounts = Array.isArray(savedAccounts)
            ? savedAccounts.filter(account => typeof account === "string")
            : [];
        const normalizedEmail = email.trim().toLowerCase();

        localStorage.setItem(
            "dolisAccounts",
            JSON.stringify([
                normalizedEmail,
                ...accounts.filter(account => account !== normalizedEmail)
            ].slice(0, 5))
        );
    } catch (error) {
        console.warn("Could not remember this account on this browser.", error);
    }
}

const savedAccountsField = document.getElementById("savedAccountsField");
const savedAccountsSelect = document.getElementById("savedAccounts");
const emailInput = document.getElementById("email");

if (savedAccountsField && savedAccountsSelect && emailInput) {
    try {
        const storedAccounts = JSON.parse(
            localStorage.getItem("dolisAccounts") || "[]"
        );
        const savedAccounts = Array.isArray(storedAccounts)
            ? storedAccounts.filter(account =>
                typeof account === "string" &&
                account.includes("@") &&
                account.length <= 254
            )
            : [];

        if (savedAccounts.length > 0) {
            savedAccountsField.hidden = false;
            savedAccounts.forEach(function (account) {
                const option = document.createElement("option");
                option.value = account;
                option.textContent = account;
                savedAccountsSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.warn("Could not load saved accounts from this browser.", error);
    }

    savedAccountsSelect.addEventListener("change", function () {
        if (savedAccountsSelect.value) {
            emailInput.value = savedAccountsSelect.value;
            document.getElementById("password").focus();
        }
    });
}

const registerForm = document.getElementById("registerForm");
if (registerForm) {
    registerForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const fullName = document.getElementById("fullname").value.trim();
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const confirmPassword = document.getElementById("confirmPassword").value;

        if (password !== confirmPassword) {
            showMessage("Passwords do not match.");
            return;
        }

        setFormBusy(registerForm, true);
        showMessage("");

        try {
            await submitAuthRequest("/api/auth/register", {
                fullName,
                email,
                password
            });
            rememberAccount(email);
            window.location.href = "dashboard.html";
        } catch (error) {
            showMessage(error.message);
            console.error("Registration failed.", error);
        } finally {
            setFormBusy(registerForm, false);
        }
    });
}

const loginForm = document.getElementById("loginForm");
if (loginForm) {
    loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;

        setFormBusy(loginForm, true);
        showMessage("");

        try {
            await submitAuthRequest("/api/auth/login", { email, password });
            rememberAccount(email);
            window.location.href = "dashboard.html";
        } catch (error) {
            showMessage(error.message);
            console.error("Login failed.", error);
        } finally {
            setFormBusy(loginForm, false);
        }
    });
}
