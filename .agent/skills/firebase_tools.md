# Firebase Tools Guidelines

## Context
This project uses the Firebase CLI configured through `firebase.json`.

## Best Practices
1. **Do not run manual deployments** (`firebase deploy`). The project has a GitHub Action configured for automatic deployment upon pushing to the repository.
2. **Local Emulator**: You can test the project locally. However, if the project is primarily static, just running `npm run dev` or `npx live-server public` is often sufficient.
3. If changing Firebase configuration (`firebase.json` or `database.rules.json`), ensure to double check that syntax is valid and rules adhere to security standards.
