# CampusConnect Interactive Pack — setup (2 minutes)

Two files, no libraries, no build step.

```
AIP prj/
├── app.py
├── static/
│   ├── interactive.css   ← copy here
│   └── interactive.js    ← copy here
└── templates/
    └── (your events template / base.html)
```

## 1. Add two tags

In the template that renders the events page (or `base.html` to enable it everywhere):

```html
<!-- inside <head> -->
<link rel="stylesheet" href="{{ url_for('static', filename='interactive.css') }}">

<!-- just before </body> -->
<script src="{{ url_for('static', filename='interactive.js') }}" defer></script>
```

Restart Flask if needed and hard-refresh the browser (`Ctrl + F5`) so the old CSS/JS isn't cached.

That's it. The script finds your event cards by looking for a `YYYY-MM-DD` date inside each card, so it works with your current markup.

## 2. What you get

| Feature | How to use it |
|---|---|
| Live search with highlight | Type in the search bar, or press `/` |
| Category chips | Tech / Cultural / Workshop / ... (guessed from title + description) |
| Sort | Featured, soonest, latest, A → Z |
| Save events ♥ | Heart on each card, "Saved" filter button (kept in the browser) |
| Live countdown | Pill on every card and a "Next up" ticker in the hero |
| Quick-view modal | Click a card: ticking countdown, register, add to calendar (.ics), copy link |
| Register | Confetti and toast; talks to your backend if you set an endpoint (see 4) |
| Dark mode | 🌙 button bottom-right, remembered |
| Extras | Scroll progress bar, back-to-top, card tilt, hero glow, "Explore events ↓" smooth scroll, deep links (`/#tech-fest-2026`), `Esc` closes the modal |

## 3. If something isn't detected

Set a selector **before** loading the script:

```html
<script>
  window.CC_CONFIG = {
    cardSelector: '.event-card'   // your card class
  };
</script>
<script src="{{ url_for('static', filename='interactive.js') }}" defer></script>
```

Optional attributes you can put on each card for better control:

```html
<div class="event-card" data-event-id="{{ e.id }}" data-category="Tech" data-date="{{ e.date }}">
```

- `data-event-id`: your database id (used for register and deep links)
- `data-category`: overrides the auto-guessed category
- Save-button position is a CSS variable: `.cc-card { --cc-save-top: 20px; --cc-save-right: 70px; }`

## 4. Optional: make "Register" talk to Flask

```html
<script>
  window.CC_CONFIG = { registerEndpoint: '/api/register', loginUrl: '/login' };
</script>
```

The script POSTs JSON `{ "event_id": "...", "title": "...", "date": "2026-11-20" }`. Reply with `{"ok": true}`, or status 401/403 when the user isn't logged in.

Starter route (adapt the session key and table names to your `portal.db`):

```python
from flask import request, session, jsonify

@app.route('/api/register', methods=['POST'])
def api_register():
    if 'user_id' not in session:                 # <- your login session key
        return jsonify(ok=False, error='login_required'), 401
    data = request.get_json(force=True)
    event_id = data.get('event_id')
    # TODO: INSERT OR IGNORE INTO registrations (user_id, event_id) VALUES (?, ?)
    return jsonify(ok=True)
```

Without `registerEndpoint`, registering only marks the event as registered in the browser (good for demos).

## 5. Dark mode note

Dark mode uses generic overrides (body, cards, nav, footer). If a part of your page stays light, add a rule at the bottom of `interactive.css`, for example:

```css
html[data-theme="dark"] .your-class { background: #1a1830 !important; color: #ece9ff; }
```

Change the theme colour in one place: `--cc-accent` / `--cc-accent-2` at the top of `interactive.css`.
