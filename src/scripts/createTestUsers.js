const mongoose = require('mongoose');
const User = require('../models/User');

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cloaks-gambit')
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

async function createOrUpdateUser({ username, email }) {
  const update = { email };
  const options = { upsert: true, new: true, setDefaultsOnInsert: true };
  const user = await User.findOneAndUpdate(
    { username },
    update,
    options
  );
  return user;
}

async function createTestUsers() {
  try {
    // Upsert first test user
    const user1 = await createOrUpdateUser({
      username: 'testUser1',
      email: 'test1@example.com'
    });
    console.log('Upserted test user 1:', user1);

    // Upsert second test user
    const user2 = await createOrUpdateUser({
      username: 'testUser2',
      email: 'test2@example.com'
    });
    console.log('Upserted test user 2:', user2);

    console.log('Successfully upserted test users');
  } catch (error) {
    console.error('Error upserting test users:', error);
  } finally {
    // Close the MongoDB connection
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

// Run the script
createTestUsers(); 