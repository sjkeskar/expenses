#!/bin/sh
# Applies migrations, creates the first developer account if the database
# has no users yet, then starts the server.
set -e
echo "Applying database migrations..."
npx prisma migrate deploy
node docker/bootstrap-developer.js
exec node src/server.js
