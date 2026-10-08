(async () => {
    try {
        const response = await fetch("/api/auth/me");
        if (!response.ok) {
            window.location.replace("/login.html");
            return;
        }
        const { user } = await response.json();
        document.body.dataset.role = user.role;
        document.body.dataset.username = user.username;

        const bar = document.createElement("div");
        bar.className = "auth-bar";
        const identity = document.createElement("span");
        identity.className = "auth-username";
        identity.textContent = user.username;
        const role = document.createElement("span");
        role.className = "auth-role";
        role.textContent = user.role;
        const logout = document.createElement("button");
        logout.className = "auth-logout";
        logout.type = "button";
        logout.textContent = "Log out";
        logout.addEventListener("click", async () => {
            logout.disabled = true;
            try { await fetch("/api/auth/logout", { method: "POST" }); }
            finally { window.location.replace("/login.html"); }
        });
        bar.append(identity, role, logout);
        const sidebar = document.querySelector(".sidebar");
        if (sidebar) {
            bar.classList.add("sidebar-account");
            sidebar.appendChild(bar);
        } else {
            bar.classList.add("auth-floating");
            document.body.appendChild(bar);
        }
    } catch {
        window.location.replace("/login.html");
    }
})();
