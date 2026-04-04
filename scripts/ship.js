const { execSync } = require('child_process');
const readline = require('readline');

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

  try {
    execSync(
      'git remote set-url origin https://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@github.com/olaj39767-ship-it/ollanback.git',
      { stdio: 'inherit' }
    );
    execSync('git add .', { stdio: 'inherit' });
    execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
    execSync('git push origin main', { stdio: 'inherit' });
    console.log('✅ Shipped!');
  } catch (err) {
    console.error('❌ Failed:', err.message);
    process.exit(1);
  }

  rl.close();
});