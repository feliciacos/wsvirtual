# Admin Portal (Downloader)

API:
- GET /api/settings -> returns JSON settings
- POST /api/settings -> writes JSON settings to Downloader/Admin/settings.json

To run locally (dev):
1. cd Downloader/Admin
2. npm ci
3. node server/index.js         # starts the small settings API
4. npm run dev                  # starts vite dev server (http://localhost:5174)

To run in docker-compose: start the `adminportal` service and bind host IP you want to expose:
- We map host ip:port to container port: `"10.0.0.2:5174:5174"` in docker-compose
