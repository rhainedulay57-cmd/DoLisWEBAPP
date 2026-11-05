document.addEventListener("DOMContentLoaded", async function () {
    const profileButton = document.getElementById("profileButton");
    const profileDropdown = document.getElementById("profileDropdown");
    const profileName = document.getElementById("profileName");
    const profileEmail = document.getElementById("profileEmail");
    const profileInitial = document.getElementById("profileInitial");

    function setMenuOpen(open) {
        if (!profileButton || !profileDropdown) {
            return;
        }

        profileDropdown.hidden = !open;
        profileButton.setAttribute("aria-expanded", String(open));
    }

    profileButton?.addEventListener("click", function () {
        setMenuOpen(profileDropdown.hidden);
    });

    document.addEventListener("click", function (event) {
        if (
            profileDropdown &&
            !profileDropdown.hidden &&
            !profileDropdown.contains(event.target) &&
            !profileButton.contains(event.target)
        ) {
            setMenuOpen(false);
        }
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            setMenuOpen(false);
        }
    });

    try {
        const response = await fetch("/api/auth/me", {
            credentials: "same-origin"
        });

        if (response.status === 401) {
            window.location.href = "login.html";
            return;
        }
        if (!response.ok) {
            throw new Error("Could not load account information.");
        }

        const user = await response.json();
        if (profileName) {
            profileName.textContent = user.fullName;
        }
        if (profileEmail) {
            profileEmail.textContent = user.email;
        }
        if (profileInitial) {
            profileInitial.textContent =
                (user.fullName || user.email || "U").charAt(0).toUpperCase();
        }

        try {
            const storedAccounts = JSON.parse(
                localStorage.getItem("dolisAccounts") || "[]"
            );
            const accounts = Array.isArray(storedAccounts)
                ? storedAccounts.filter(account => typeof account === "string")
                : [];
            const email = user.email.toLowerCase();

            localStorage.setItem(
                "dolisAccounts",
                JSON.stringify([
                    email,
                    ...accounts.filter(account => account !== email)
                ].slice(0, 5))
            );
        } catch (error) {
            console.warn("Could not remember this account on this browser.", error);
        }
    } catch (error) {
        console.error("Could not load the account menu.", error);
        window.alert("Could not load your account. Please refresh and try again.");
    }

    async function leaveCurrentAccount(destination) {
        try {
            const response = await fetch("/api/auth/logout", {
                method: "POST",
                credentials: "same-origin"
            });
            if (!response.ok) {
                throw new Error("Could not sign out (" + response.status + ").");
            }
            window.location.href = destination;
        } catch (error) {
            console.error("Could not leave the current account.", error);
            window.alert(error.message);
        }
    }

    document.getElementById("switchAccountButton")?.addEventListener(
        "click",
        function () {
            leaveCurrentAccount("login.html?switch=1");
        }
    );

    document.getElementById("addAccountButton")?.addEventListener(
        "click",
        function () {
            leaveCurrentAccount("register.html?add=1");
        }
    );

    document.getElementById("logoutButton")?.addEventListener(
        "click",
        function () {
            leaveCurrentAccount("login.html");
        }
    );
});
