# Local Development Workflow

## Setup
Ensure dependencies are installed:
```bash
npm install
```

## Running the app
To run a local live-reload server:
```bash
npm run start
```
*Note: Make sure your PowerShell execution policies allow for scripts to run.*

Navigate to `http://127.0.0.1:8080/` (or port specified by `http-server`) in your browser to view the game.

## Troubleshooting
If `npm start` fails due to execution policy, test the file layout by directly open `public/index.html` via a browser, or run `npx http-server public`.
