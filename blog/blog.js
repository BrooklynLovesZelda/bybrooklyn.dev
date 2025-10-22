const API_BASE = "/api";
const STORAGE_KEY = "blog-auth-token";

const authPanel = document.getElementById("auth-panel");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const signOutButton = document.getElementById("sign-out");
const postsContainer = document.getElementById("posts");
const postForm = document.getElementById("post-form");
const postTitle = document.getElementById("post-title");
const postBody = document.getElementById("post-body");
const editorMessage = document.getElementById("editor-message");
const exportButton = document.getElementById("export-posts");
const clearButton = document.getElementById("clear-posts");
const publishButton = document.getElementById("publish-post");
const visitorNote = document.getElementById("visitor-note");
const adminNote = document.getElementById("admin-note");

let state = {
  token: null,
  posts: [],
  authed: false,
};

class UnauthorizedError extends Error {}

function loadToken() {
  return localStorage.getItem(STORAGE_KEY);
}

function saveToken(token) {
  if (token) {
    localStorage.setItem(STORAGE_KEY, token);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  state.token = token;
}

function authHeaders(headers = {}) {
  const token = state.token;
  if (!token) {
    return headers;
  }
  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  };
}

async function fetchJSON(path, options = {}) {
  const opts = { ...options };
  opts.headers = opts.headers ? { ...opts.headers } : {};

  if (opts.body && !opts.headers["Content-Type"]) {
    opts.headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE}${path}`, opts);

  if (response.status === 401) {
    throw new UnauthorizedError("Unauthorized");
  }

  if (!response.ok) {
    const text = await response.text();
    const message = text || response.statusText || "Request failed.";
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function setAuthState(isAuthed) {
  state.authed = isAuthed;
  if (isAuthed) {
    authPanel.classList.add("hidden");
    authPanel.setAttribute("hidden", "");
    signOutButton.classList.remove("hidden");
    signOutButton.removeAttribute("hidden");
    postForm.classList.remove("hidden");
    postForm.removeAttribute("hidden");
    adminNote.classList.remove("hidden");
    adminNote.removeAttribute("hidden");
    visitorNote.classList.add("hidden");
    visitorNote.setAttribute("hidden", "");
    loginError.textContent = "";
    publishButton.disabled = false;
    clearButton.disabled = false;
  } else {
    signOutButton.classList.add("hidden");
    signOutButton.setAttribute("hidden", "");
    postForm.classList.add("hidden");
    postForm.setAttribute("hidden", "");
    adminNote.classList.add("hidden");
    adminNote.setAttribute("hidden", "");
    visitorNote.classList.remove("hidden");
    visitorNote.removeAttribute("hidden");
    authPanel.classList.remove("hidden");
    authPanel.removeAttribute("hidden");
    loginForm.reset();
    editorMessage.textContent = "";
    publishButton.disabled = false;
    clearButton.disabled = false;
  }
  renderPosts();
}

async function handleLogin(event) {
  event.preventDefault();
  loginError.textContent = "";

  const username = loginForm.username.value.trim();
  const password = loginForm.password.value;
  if (!username || !password) {
    loginError.textContent = "Enter both username and password.";
    return;
  }

  try {
    const result = await fetchJSON("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    saveToken(result.token);
    setAuthState(true);
    await loadPosts();
    editorMessage.textContent = "Welcome back! You're signed in.";
  } catch (error) {
    console.error(error);
    if (error instanceof UnauthorizedError) {
      loginError.textContent = "Credentials were incorrect.";
    } else {
      loginError.textContent = "Unable to sign in. Please try again.";
    }
  }
}

async function handleSignOut() {
  if (state.token) {
    try {
      await fetchJSON("/logout", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
      });
    } catch (error) {
      console.warn("Failed to revoke token", error);
    }
  }
  saveToken(null);
  setAuthState(false);
  await loadPosts();
}

async function loadPosts() {
  try {
    const result = await fetchJSON("/posts", {
      method: "GET",
      headers: authHeaders(),
    });
    state.posts = Array.isArray(result.posts) ? result.posts : [];
    renderPosts();
  } catch (error) {
    console.error(error);
    if (error instanceof UnauthorizedError) {
      saveToken(null);
      setAuthState(false);
      loginError.textContent = "Session expired. Please sign in again.";
    } else {
      editorMessage.textContent = "Unable to load posts at the moment.";
    }
  }
}

function renderPosts() {
  if (!state.posts.length) {
    postsContainer.innerHTML =
      '<div class="post empty">No posts yet. Use the editor below to add one!</div>';
    return;
  }

  postsContainer.innerHTML = state.posts
    .map((post) => {
      const time = new Date(post.createdAt).toLocaleString();
      const escapedTitle = escapeHtml(post.title);
      const escapedBody = escapeHtml(post.body).replace(/\n/g, "<br/>");
      const deleteButton = state.authed
        ? `<button class="delete-post danger" data-id="${post.id}">Delete</button>`
        : "";

      return `
        <article class="post" data-id="${post.id}">
          <div class="post-header">
            <h3>${escapedTitle}</h3>
            ${deleteButton}
          </div>
          <time datetime="${post.createdAt}">${time}</time>
          <p>${escapedBody}</p>
        </article>
      `;
    })
    .join("");

  if (state.authed) {
    postsContainer
      .querySelectorAll(".delete-post")
      .forEach((button) =>
        button.addEventListener("click", handleDeletePost, { once: true })
      );
  }
}

async function handleCreatePost(event) {
  event.preventDefault();

  if (!state.authed) {
    editorMessage.textContent = "Sign in to publish posts.";
    return;
  }

  publishButton.disabled = true;

  const title = postTitle.value.trim();
  const body = postBody.value.trim();

  if (!title || !body) {
    editorMessage.textContent = "Add both a title and content before publishing.";
    publishButton.disabled = false;
    return;
  }

  try {
    const newPost = await fetchJSON("/posts", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ title, body }),
    });
    state.posts = [newPost, ...state.posts];
    postForm.reset();
    editorMessage.textContent = "Post published.";
    renderPosts();
  } catch (error) {
    console.error(error);
    if (error instanceof UnauthorizedError) {
      saveToken(null);
      setAuthState(false);
      loginError.textContent = "Session expired. Please sign in again.";
    } else {
      editorMessage.textContent = "Unable to publish. Please try again.";
    }
  } finally {
    publishButton.disabled = false;
  }
}

async function handleDeletePost(event) {
  const button = event.currentTarget;
  if (!state.authed) {
    editorMessage.textContent = "Sign in to manage posts.";
    return;
  }
  const id = button.dataset.id;
  if (!id) {
    return;
  }
  const confirmed = window.confirm("Delete this post?");
  if (!confirmed) {
    return;
  }

  button.disabled = true;

  try {
    await fetchJSON(`/posts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    state.posts = state.posts.filter((post) => post.id !== id);
    editorMessage.textContent = "Post deleted.";
    renderPosts();
  } catch (error) {
    console.error(error);
    button.disabled = false;
    if (error instanceof UnauthorizedError) {
      saveToken(null);
      setAuthState(false);
      loginError.textContent = "Session expired. Please sign in again.";
    } else {
      editorMessage.textContent = "Unable to delete post.";
    }
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function handleExport() {
  if (!state.posts.length) {
    editorMessage.textContent = "There are no posts to export.";
    return;
  }
  const payload = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      count: state.posts.length,
      posts: state.posts,
    },
    null,
    2
  );
  downloadFile({
    name: `brooklyn-blog-${new Date().toISOString().slice(0, 10)}.json`,
    content: payload,
    type: "application/json",
  });
  editorMessage.textContent = "Export downloaded.";
}

async function handleClear() {
  if (!state.posts.length) {
    editorMessage.textContent = "Nothing to clear.";
    return;
  }
  if (!state.authed) {
    editorMessage.textContent = "Sign in to remove posts.";
    return;
  }
  const confirmed = window.confirm(
    "This will delete all posts from the server. Continue?"
  );
  if (!confirmed) {
    return;
  }

  clearButton.disabled = true;
  try {
    const deleteRequests = state.posts.map((post) =>
      fetchJSON(`/posts/${encodeURIComponent(post.id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      })
    );
    await Promise.all(deleteRequests);
    state.posts = [];
    editorMessage.textContent = "All posts removed.";
    renderPosts();
  } catch (error) {
    console.error(error);
    if (error instanceof UnauthorizedError) {
      saveToken(null);
      setAuthState(false);
      loginError.textContent = "Session expired. Please sign in again.";
    } else {
      editorMessage.textContent = "Unable to clear posts.";
    }
  } finally {
    clearButton.disabled = false;
  }
}

function downloadFile({ name, content, type }) {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

loginForm.addEventListener("submit", handleLogin);
signOutButton.addEventListener("click", handleSignOut);
postForm.addEventListener("submit", handleCreatePost);
exportButton.addEventListener("click", handleExport);
clearButton.addEventListener("click", handleClear);

saveToken(loadToken());
setAuthState(Boolean(state.token));
loadPosts();
