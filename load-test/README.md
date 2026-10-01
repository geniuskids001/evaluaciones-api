# Genius Quiz autonomous load test

Creates its own recognizable staging session, exercises the real API, verifies integrity, physically deletes the test session and cascaded participant data, then overwrites `reports/latest.md` and `reports/latest.json`.

Required: `API_BASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `DB_USER`, `DB_PASSWORD`, and either `DB_SOCKET_PATH` or `DB_HOST`/`DB_PORT`.

Defaults: `USERS=550`, `POLL_SECONDS=10`, `REQUEST_TIMEOUT_MS=30000`, `LOAD_TEST_DB_CLEANUP=true`.

Safety:
- Session names start with `LOAD TEST AUTO`.
- Uses an existing published evaluation and never edits it.
- Does not send email.
- Uses real participant API routes.
- Physical cleanup deletes only the created `sesiones_evaluacion` row; existing ON DELETE CASCADE removes its applications, answers, results and email rows.
- If physical cleanup cannot be confirmed, result is `FAIL_CLEANUP`.
- Never commit credentials or secrets.
