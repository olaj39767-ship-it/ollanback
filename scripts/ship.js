const { execSync } = require('child_process');
const readline = require('readline');
require('dotenv').config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Commit message: ', (message) => {
  if (!message.trim()) {
    console.log('❌ Commit message cannot be empty');
    rl.close();
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log('❌ GITHUB_TOKEN not found in .env');
    rl.close();
    process.exit(1);
  }

  try {
    execSync(
      `git remote set-url origin https://${token}@github.com/olaj39767-ship-it/ollanback.git`,
      { stdio: 'inherit' }
    );

    execSync('git add .', { stdio: 'inherit' });

    // Check if there's anything to commit
    const status = execSync('git status --porcelain').toString().trim();
    if (status) {
      execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
    } else {
      console.log('ℹ️  Nothing new to commit, pushing existing commits...');
    }

    execSync('git push origin main', { stdio: 'inherit' });
    console.log('✅ Shipped!');
  } catch (err) {
    console.error('❌ Failed:', err.message);
    process.exit(1);
  }

  rl.close();
});