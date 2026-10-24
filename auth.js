(function () {
  const SESSION_KEY = "ninety-session-v3";
  let cachedUser = null;
  let authConfig = { googleClientId: "", appleClientId: "" };
  let googleReady = false;
  let appleReady = false;
  let initPromise = null;

  function publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email || "",
      phone: user.phone || "",
      username: user.username || "",
      provider: user.provider,
      picture: user.picture || "",
      favorites: Array.isArray(user.favorites) ? user.favorites : [],
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  function setCached(user) {
    cachedUser = publicUser(user);
    if (cachedUser) localStorage.setItem(SESSION_KEY, JSON.stringify(cachedUser));
    else localStorage.removeItem(SESSION_KEY);
    return cachedUser;
  }

  function readCached() {
    if (cachedUser) return cachedUser;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      cachedUser = raw ? JSON.parse(raw) : null;
    } catch {
      cachedUser = null;
    }
    return cachedUser;
  }

  async function api(path, { method = "GET", body } = {}) {
    const opts = {
      method,
      credentials: "include",
      headers: { Accept: "application/json" },
    };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      throw new Error((data && data.error) || `Request failed (${res.status})`);
    }
    return data;
  }

  function loadScript(src, id) {
    return new Promise((resolve, reject) => {
      if (id && document.getElementById(id)) {
        resolve();
        return;
      }
      const el = document.createElement("script");
      if (id) el.id = id;
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(el);
    });
  }

  async function loadConfig() {
    try {
      const cfg = await api("/api/auth/config");
      authConfig = {
        googleClientId: cfg.googleClientId || "",
        appleClientId: cfg.appleClientId || "",
      };
    } catch {
      authConfig = { googleClientId: "", appleClientId: "" };
    }
    return authConfig;
  }

  async function restoreSession() {
    try {
      const data = await api("/api/auth/me");
      if (data.user) return setCached(data.user);
      // Keep local cache only if server has no session yet (offline-ish)
      const local = readCached();
      return local;
    } catch {
      return readCached();
    }
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      await loadConfig();
      await restoreSession();
      if (authConfig.googleClientId) {
        try {
          await loadScript("https://accounts.google.com/gsi/client", "google-gsi");
          if (window.google?.accounts?.id) {
            window.google.accounts.id.initialize({
              client_id: authConfig.googleClientId,
              callback: async (response) => {
                try {
                  await loginWithGoogleCredential(response.credential);
                  window.dispatchEvent(new CustomEvent("ninety-auth", { detail: { user: currentUser() } }));
                } catch (err) {
                  window.dispatchEvent(
                    new CustomEvent("ninety-auth-error", { detail: { error: err.message || String(err) } })
                  );
                }
              },
              auto_select: false,
              cancel_on_tap_outside: true,
            });
            googleReady = true;
          }
        } catch (err) {
          console.warn("Google GIS unavailable", err);
        }
      }
      if (authConfig.appleClientId) {
        try {
          await loadScript(
            "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js",
            "apple-auth"
          );
          if (window.AppleID?.auth) {
            window.AppleID.auth.init({
              clientId: authConfig.appleClientId,
              scope: "name email",
              redirectURI: window.location.origin,
              usePopup: true,
            });
            appleReady = true;
          }
        } catch (err) {
          console.warn("Apple Sign In unavailable", err);
        }
      }
      return { config: authConfig, user: currentUser(), googleReady, appleReady };
    })();
    return initPromise;
  }

  async function register(payload) {
    const data = await api("/api/auth/register", { method: "POST", body: payload });
    return setCached(data.user);
  }

  async function login(payload) {
    const data = await api("/api/auth/login", { method: "POST", body: payload });
    return setCached(data.user);
  }

  async function loginWithGoogleCredential(credential) {
    const data = await api("/api/auth/google", { method: "POST", body: { credential } });
    return setCached(data.user);
  }

  async function loginWithApplePayload(payload) {
    const data = await api("/api/auth/apple", { method: "POST", body: payload });
    return setCached(data.user);
  }

  async function socialLogin(provider, profile = {}) {
    const data = await api("/api/auth/social", {
      method: "POST",
      body: {
        provider,
        email: profile.email,
        name: profile.name,
        picture: profile.picture || "",
      },
    });
    return setCached(data.user);
  }

  function promptIdentity(provider) {
    return new Promise((resolve, reject) => {
      const existing = document.getElementById("ninety-auth-sheet");
      if (existing) existing.remove();

      const isApple = provider === "apple";
      const sheet = document.createElement("div");
      sheet.id = "ninety-auth-sheet";
      sheet.className = "auth-sheet";
      sheet.innerHTML = `
        <div class="auth-sheet-card" role="dialog" aria-modal="true" aria-label="Sign in with ${isApple ? "Apple" : "Google"}">
          <div class="auth-sheet-brand ${isApple ? "is-apple" : "is-google"}">
            <span class="auth-sheet-logo" aria-hidden="true">${isApple ? "" : "G"}</span>
            <div>
              <p class="auth-sheet-title">Continue with ${isApple ? "Apple" : "Google"}</p>
              <p class="auth-sheet-sub">Your account is saved on NINETY so favourites stay with you.</p>
            </div>
          </div>
          <form class="auth-sheet-form">
            <label>Name<input name="name" required autocomplete="name" placeholder="Your name" /></label>
            <label>Email<input name="email" type="email" required autocomplete="email" placeholder="you@${isApple ? "icloud.com" : "gmail.com"}" /></label>
            <p class="auth-sheet-error" hidden></p>
            <div class="auth-sheet-actions">
              <button type="button" class="auth-btn secondary" data-cancel>Cancel</button>
              <button type="submit" class="auth-btn ${isApple ? "apple" : "google"}">Save &amp; continue</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(sheet);

      const form = sheet.querySelector("form");
      const errorEl = sheet.querySelector(".auth-sheet-error");
      const close = (value, isError) => {
        sheet.remove();
        if (isError) reject(value);
        else resolve(value);
      };

      sheet.addEventListener("click", (e) => {
        if (e.target === sheet) close(new Error("Cancelled"), true);
      });
      sheet.querySelector("[data-cancel]").addEventListener("click", () => close(new Error("Cancelled"), true));
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const data = new FormData(form);
        const name = String(data.get("name") || "").trim();
        const email = String(data.get("email") || "").trim().toLowerCase();
        if (!name || !email || !email.includes("@")) {
          errorEl.hidden = false;
          errorEl.textContent = "Enter a valid name and email.";
          return;
        }
        close({ name, email });
      });
      form.querySelector('input[name="name"]').focus();
    });
  }

  async function continueWithGoogle() {
    await init();
    if (googleReady && window.google?.accounts?.id) {
      return new Promise((resolve, reject) => {
        const done = (user) => resolve(user);
        const fail = (err) => reject(err instanceof Error ? err : new Error(String(err)));

        const onOk = (e) => {
          cleanup();
          done(e.detail.user);
        };
        const onErr = (e) => {
          cleanup();
          fail(e.detail.error);
        };
        const cleanup = () => {
          window.removeEventListener("ninety-auth", onOk);
          window.removeEventListener("ninety-auth-error", onErr);
        };
        window.addEventListener("ninety-auth", onOk);
        window.addEventListener("ninety-auth-error", onErr);

        // Prefer One Tap / prompt; fall back to identity sheet if blocked
        try {
          window.google.accounts.id.prompt((notification) => {
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
              cleanup();
              promptIdentity("google")
                .then((profile) => socialLogin("google", profile))
                .then(resolve)
                .catch(reject);
            }
          });
        } catch (err) {
          cleanup();
          promptIdentity("google")
            .then((profile) => socialLogin("google", profile))
            .then(resolve)
            .catch(reject);
        }
      });
    }
    const profile = await promptIdentity("google");
    return socialLogin("google", profile);
  }

  async function continueWithApple() {
    await init();
    if (appleReady && window.AppleID?.auth) {
      try {
        const res = await window.AppleID.auth.signIn();
        const user = res?.user || {};
        const nameParts = [user.name?.firstName, user.name?.lastName].filter(Boolean);
        return loginWithApplePayload({
          email: user.email || res?.email || "",
          name: nameParts.join(" ") || "Apple Fan",
          sub: res?.authorization?.id_token || user.email || "",
        });
      } catch (err) {
        // User cancelled or domain not registered — fall through to saved identity
        if (String(err?.error || err).toLowerCase().includes("popup_closed")) throw err;
      }
    }
    const profile = await promptIdentity("apple");
    return socialLogin("apple", profile);
  }

  async function logout() {
    try {
      await api("/api/auth/logout");
    } catch {
      /* ignore */
    }
    setCached(null);
  }

  function currentUser() {
    return readCached();
  }

  async function updateFavorites(favorites) {
    const session = currentUser();
    if (!session?.id) return null;
    try {
      const data = await api("/api/auth/favorites", {
        method: "POST",
        body: { favorites: Array.isArray(favorites) ? favorites : [] },
      });
      return setCached(data.user);
    } catch (err) {
      console.warn("Could not sync favourites", err);
      const next = { ...session, favorites: Array.isArray(favorites) ? favorites : [] };
      return setCached(next);
    }
  }

  async function saveConfig(patch) {
    const data = await api("/api/auth/config", { method: "POST", body: patch });
    authConfig = {
      googleClientId: data.googleClientId || "",
      appleClientId: data.appleClientId || "",
    };
    initPromise = null;
    googleReady = false;
    appleReady = false;
    await init();
    return authConfig;
  }

  function getConfig() {
    return { ...authConfig, googleReady, appleReady };
  }

  function renderGoogleButton(container) {
    if (!googleReady || !container || !window.google?.accounts?.id) return false;
    container.innerHTML = "";
    window.google.accounts.id.renderButton(container, {
      theme: "filled_black",
      size: "large",
      shape: "pill",
      text: "continue_with",
      width: container.clientWidth || 320,
    });
    return true;
  }

  window.NINETY_AUTH = {
    init,
    register,
    login,
    socialLogin,
    continueWithGoogle,
    continueWithApple,
    loginWithGoogleCredential,
    logout,
    currentUser,
    updateFavorites,
    saveConfig,
    getConfig,
    renderGoogleButton,
  };
})();
