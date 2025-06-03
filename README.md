# Cloaks Gambit API

A REST API application built with Node.js and MongoDB.

## Prerequisites

- Node.js (v14 or higher)
- MongoDB (local installation or MongoDB Atlas account)

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory with the following variables:
   ```
   PORT=3000
   MONGODB_URI=mongodb://localhost:27017/cloaks-gambit
   NODE_ENV=development
   ```

## Running the Application

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

### Users
- GET /api/users - Get all users
- POST /api/users - Create a new user

### Lobby
- POST /api/v1/lobby/get - Retrieve the current lobby queues
- POST /api/v1/lobby/enterQuickplay - Join the quickplay queue
- POST /api/v1/lobby/exitQuickplay - Leave the quickplay queue
- POST /api/v1/lobby/enterRanked - Join the ranked queue
- POST /api/v1/lobby/exitRanked - Leave the ranked queue

## Project Structure

```
src/
├── models/         # MongoDB models
├── routes/         # API routes
├── controllers/    # Route controllers
├── middleware/     # Custom middleware
└── server.js       # Application entry point
```
