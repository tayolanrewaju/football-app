(function () {
  const USERS_KEY = "ninety-users-v2";
  const SESSION_KEY = "ninety-session-v2";

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

  function publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email || "",
      phone: user.phone || "",
      username: user.username || "",
      provider: user.provider,
      favorites: Array.isArray(user.favorites) ? user.favorites : [],
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  function setSession(user) {
    if (!user) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(publicUser(user)));
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

  function upsertUser(next) {
    const users = loadUsers();
    const idx = users.findIndex((u) => u.id === next.id);
    next.updatedAt = new Date().toISOString();
    if (idx >= 0) users[idx] = next;
    else users.push(next);
    saveUsers(users);
    setSession(next);
    return publicUser(next);
  }

  function register({ name, email, username, phone, password }) {
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
      favorites: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return upsertUser(user);
  }

  function login({ identity, password }) {
    const user = findUser(identity);
    if (!user || user.password !== password) {
      throw new Error("Incorrect details. Check your email/username/phone and password.");
    }
    setSession(user);
    return publicUser(user);
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
        favorites: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    return upsertUser(user);
  }

  function logout() {
    setSession(null);
  }

  function currentUser() {
    const session = getSession();
    if (!session?.id) return null;
    const fresh = loadUsers().find((u) => u.id === session.id);
    return publicUser(fresh || session);
  }

  function updateFavorites(favorites) {
    const session = getSession();
    if (!session?.id) return null;
    const users = loadUsers();
    const idx = users.findIndex((u) => u.id === session.id);
    if (idx < 0) return null;
    users[idx].favorites = Array.isArray(favorites) ? favorites : [];
    users[idx].updatedAt = new Date().toISOString();
    saveUsers(users);
    setSession(users[idx]);
    return publicUser(users[idx]);
  }

  function updateProfile(patch) {
    const session = getSession();
    if (!session?.id) throw new Error("Not signed in.");
    const users = loadUsers();
    const idx = users.findIndex((u) => u.id === session.id);
    if (idx < 0) throw new Error("Account not found.");
    const user = users[idx];
    if (patch.name) user.name = String(patch.name).trim();
    if (patch.email != null) user.email = String(patch.email).trim();
    if (patch.username != null) user.username = String(patch.username).trim();
    if (patch.phone != null) user.phone = String(patch.phone).trim();
    return upsertUser(user);
  }

  window.NINETY_AUTH = {
    register,
    login,
    socialLogin,
    logout,
    currentUser,
    updateFavorites,
    updateProfile,
  };
})();
