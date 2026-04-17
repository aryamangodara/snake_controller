# Deployment Workflow

## Overview
This project relies on GitHub Actions for Continuous Deployment. No manual `firebase deploy` commands are necessary.

## Steps
1. Make necessary changes to the `public/` directory files or configurations.
2. Stage and commit the changes following standard formatting.
3. Push changes to the `main` branch.
   ```bash
   git push origin main
   ```
4. GitHub Actions will intercept the push and execute the deployment directly to Firebase.

## Avoiding Mistakes
Do NOT use the CLI `firebase deploy` to prevent conflicting metadata or desyncing the local state from the CI/CD pipeline truth.
