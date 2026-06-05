# Deployment Workflow

## Overview
This project relies on GitHub Actions for Continuous Deployment. No manual `firebase deploy` to
production is necessary.

The CI deploy step runs `firebase deploy --only hosting,firestore,database`, so it ships **three**
targets together: the static site (`public/`), the Firestore rules (`firestore.rules`), and the
Realtime Database rules (`database.rules.json`). Rules are now version-controlled and deployed —
do not edit them only in the Firebase console, or the next push will overwrite your console change.

## Steps
1. Make necessary changes to the `public/` directory files or configurations.
2. Stage and commit the changes following standard formatting.
3. Push changes to the `master` branch (the deploy workflow triggers on `master`).
   ```bash
   git push origin master
   ```
4. GitHub Actions will intercept the push and execute the deployment directly to Firebase.

## Changing security rules safely
Because a push to `master` deploys rules to production, **test rule changes against a throwaway
Firebase project first**:
```bash
firebase use <scratch-project>
firebase deploy --only firestore,database
# verify the app still connects + plays, then switch back and push to master
```

## Avoiding Mistakes
Do NOT run `firebase deploy` against the **production** project from your machine — let CI be the
single source of truth so local state cannot desync from the pipeline. (Deploying to a *scratch*
project for rule testing, as above, is fine.)
