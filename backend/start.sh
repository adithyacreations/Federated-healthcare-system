#!/bin/sh
set -eu

case "${DATABASE_URL:-}" in
    postgres://?*|postgresql://?*) ;;
    *)
        printf '%s\n' 'Startup requires DATABASE_URL with a PostgreSQL connection string.' >&2
        exit 1
        ;;
esac

# Django errors can include connection settings. Log only safe diagnostics.
printf '%s\n' 'Applying database migrations...'
python deploy_startup.py migrate || {
    printf '%s\n' 'Database migrations failed. Daphne was not started.' >&2
    exit 1
}
printf '%s\n' 'Database migrations complete.'

printf '%s\n' 'Collecting static files...'
python deploy_startup.py collectstatic || {
    printf '%s\n' 'Static collection failed. Daphne was not started.' >&2
    exit 1
}
printf '%s\n' 'Static collection complete.'

port=${PORT:-10000}
printf 'Starting Daphne on 0.0.0.0:%s\n' "$port"
exec daphne -b 0.0.0.0 -p "$port" federcare.asgi:application
