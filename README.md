# aurory-draft-2026
Aurory Draft for Aurory Tournament Communities

# Aurory Draft Project

Project for managing Aurory drafts, tournament tracking, and match history.

## Architecture
- **Frontend**: React (located in `/client`)
- **Backend**: Firebase (Firestore, Auth, Functions)
- **Deployment**: Firebase Hosting

## Setup Instructions

### 1. Prerequisites
- Node.js (v16+)
- Firebase CLI (`npm install -g firebase-tools`)
- Git

### 2. Installation
```bash
# Clone the repository
git clone <your-repo-url>
cd Aurory-draft

# Install dependencies
cd client
npm install
```

### 3. Environment Configuration
- Navigate to the `client` directory.
- Copy `.env.example` to `.env`.
- Fill in your Firebase configuration keys in `.env`.

### 4. Firebase Setup
```bash
# Login to Firebase
firebase login

# Select your project
firebase use --add
```

### 5. Running Locally
```bash
cd client
npm start
```

## Deployment
```bash
# Deploy Frontend
cd client
npm run build
firebase deploy --only hosting

# Deploy Firestore Rules/Indexes
firebase deploy --only firestore
```
