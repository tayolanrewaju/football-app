(function () {
  const USERS_KEY = "ninety-users-v1";
  const SESSION_KEY = "ninety-session-v1";

  function loadUsers() {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setSession(user) {
    if (!user) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        id: user.id,
        name: user.name,
        email: user.email || "",
        phone: user.phone || "",
        username: user.username || "",
        provider: user.provider,
      })
    );
  }

  function normalizeIdentity(value) {
    return String(value || "").trim().toLowerCase();
  }

  function findUser(identity) {
    const q = normalizeIdentity(identity);
    return loadUsers().find(
      (u) =>
        normalizeIdentity(u.email) === q ||
        normalizeIdentity(u.username) === q ||
        normalizeIdentity(u.phone) === q
    );
  }

  function register({ name, email, username, phone, password }) {
    const users = loadUsers();
    if (!name?.trim() || !password || password.length < 4) {
      throw new Error("Name and a password (4+ characters) are required.");
    }
    if (!email && !username && !phone) {
      throw new Error("Add an email, username, or phone number.");
    }
    if (email && findUser(email)) throw new Error("That email is already registered.");
    if (username && findUser(username)) throw new Error("That username is taken.");
    if (phone && findUser(phone)) throw new Error("That phone number is already registered.");

    const user = {
      id: crypto.randomUUID(),
      name: name.trim(),
      email: email?.trim() || "",
      username: username?.trim() || "",
      phone: phone?.trim() || "",
      password,
      provider: "email",
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    saveUsers(users);
    setSession(user);
    return user;
  }

  function login({ identity, password }) {
    const user = findUser(identity);
    if (!user || user.password !== password) {
      throw new Error("Incorrect details. Check your email/username/phone and password.");
    }
    setSession(user);
    return user;
  }

  function socialLogin(provider) {
    const label = provider === "apple" ? "Apple" : "Google";
    const email = `${provider}-user@ninety.app`;
    let user = findUser(email);
    if (!user) {
      user = {
        id: crypto.randomUUID(),
        name: `${label} Fan`,
        email,
        username: `${provider}_fan`,
        phone: "",
        password: crypto.randomUUID(),
        provider,
        createdAt: new Date().toISOString(),
      };
      const users = loadUsers();
      users.push(user);
      saveUsers(users);
    }
    setSession(user);
    return user;
  }

  function logout() {
    setSession(null);
  }

  function currentUser() {
    return getSession();
  }

  window.NINETY_AUTH = {
    register,
    login,
    socialLogin,
    logout,
    currentUser,
  };
})();
