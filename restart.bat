@echo off
echo Restarting FederCare...
docker-compose down
docker-compose up --build
