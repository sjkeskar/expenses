# Running the Laboratory Management System with Docker

You need Docker with the Compose plugin (Docker Desktop on Windows/macOS).

## 1. Load and start

You should have two files: `lab-management.tar.gz` and `docker-compose.yml`.
Put them in one folder and run:

```
docker load -i lab-management.tar.gz
docker compose up -d
```

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

## For the sender: building the shareable file

From the project root:

```
docker compose build
docker save lab-management:latest | gzip > lab-management.tar.gz
```

Send `lab-management.tar.gz`, `docker-compose.yml` and this README. The
`build:` line in the compose file is ignored once the image is loaded.
