# 75 Hard Creator Edition - Deployment Guide

## Quick Deploy to Vercel (Recommended)

### Step 1: Create a GitHub Account (if you don't have one)
Go to https://github.com and sign up

### Step 2: Create a New Repository
1. Click the "+" icon in the top right → "New repository"
2. Name it `75hard-creator`
3. Make it Public
4. Click "Create repository"

### Step 3: Upload the Files
1. Unzip the `75hard-app.zip` file on your computer
2. On your new GitHub repo page, click "uploading an existing file"
3. Drag all the files/folders from the unzipped folder
4. Click "Commit changes"

### Step 4: Deploy to Vercel
1. Go to https://vercel.com and sign up with your GitHub account
2. Click "Add New Project"
3. Import your `75hard-creator` repository
4. Click "Deploy" (default settings are fine)
5. Wait ~1 minute for it to build

### Step 5: Add to iPhone Home Screen
1. Open your new Vercel URL on your iPhone (Safari)
2. Tap the Share button (square with arrow)
3. Scroll down and tap "Add to Home Screen"
4. Name it "75 Hard" and tap "Add"

Done! You now have your custom 75 Hard app on your home screen.

---

## Adding App Icons

For the best experience, create two icon files:
- `icon-192.png` (192x192 pixels)
- `icon-512.png` (512x512 pixels)

You can create these at https://canva.com - just make a simple "75" with a spade symbol on a black background.

Upload them to the `public` folder in your GitHub repo.

---

## Troubleshooting

**App not saving data?**
- Make sure you're using the home screen version, not Safari
- Data is stored locally on your phone

**Want to reset?**
- Use the "Reset Challenge" button at the bottom of the app

**Need to update the tasks?**
- Edit `src/App.js` and change the `DAILY_TASKS` array at the top
- Push to GitHub and Vercel will auto-redeploy
