Hello I am Brooklyn!
This is my landing page for my main website. at this moment it is 100% AI but soon once i get good enough at HTML, ill recode this website. :)

## Blog studio

The blog now runs through a small Python backend (`server.py`) that serves the static files and provides an authenticated API for publishing posts. Posts are stored in a local SQLite database (`blog.db`).

### Running locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

Then open http://localhost:5000/blog/index.html to view the blog.

### Default credentials

- Username: `admin`
- Password: `postcard-lake`

To change the password, generate a SHA-256 hash and export it before starting the server:

```bash
python - <<'PY'
import hashlib
print(hashlib.sha256("your-new-password".encode("utf-8")).hexdigest())
PY

export ADMIN_PASSWORD_HASH=put-your-hash-here
python server.py
```

You can also set a different username via `ADMIN_USERNAME`. Tokens expire after 12 hours by default; change this with `BLOG_SESSION_HOURS`.
