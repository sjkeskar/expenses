# Running the Laboratory Management System with Docker

You need Docker with the Compose plugin (Docker Desktop on Windows/macOS).

## 1. Load and start

You should have two files: `lab-management-<version>.tar.gz` and
`docker-compose.yml`. Put them in one folder and run (with the real file name):

```
docker load -i lab-management-<version>.tar.gz
docker compose up -d
```

If you downloaded it from GitHub's Actions page, it arrives as a `.zip`:
extract it first and load the `.tar.gz` inside. Loading the `.zip` itself
fails with "unrecognized image format".

PostgreSQL is downloaded and set up automatically on the first run.

## 2. Sign in

Open http://localhost:8080 and sign in as:

- **Username:** `admin_dev`
- **Password:** `Admin@123`

Then open **Lab setup** to enter the lab details and create the lead
pathologist. The lead creates all other accounts.

## Useful commands

| What | Command |
|---|---|
| Stop | `docker compose down` |
| Start again (data kept) | `docker compose up -d` |
| See logs | `docker compose logs -f app` |
| Wipe all data and start fresh | `docker compose down -v` |
| Use a different port | `APP_PORT=9090 docker compose up -d` |

---

## For the sender: getting the shareable file

GitHub Actions builds it (`.github/workflows/e2e-and-image.yml`), only after
the e2e pack passes:

- **Push to `develop`, or a manual run** (Actions → "E2E and image" → Run
  workflow): the run's page has a `lab-management-<version>` download, kept
  for 14 days.
- **Push a tag such as `v1.0.1`**: the file is also attached to a GitHub
  Release of that name, which doesn't expire.

Each comes with a `.sha256` file for checking the download.

To build it locally instead, from the project root:

```
docker compose build
set -o pipefail
docker save lab-management:latest | gzip > lab-management.tar.gz
```

Send the `.tar.gz`, `docker-compose.yml` and this README. The `build:` line
in the compose file is ignored once the image is loaded.
