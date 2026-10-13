const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function run(script, args = []) {
  console.log(`\n========== ${script} ==========\n`);

  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', script), ...args],
    {
      cwd: ROOT,
      stdio: 'inherit'
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${script} завершился с кодом ${result.status}`);
  }
}

try {
  run('collect-brother.cjs');
  run('batch-brother.cjs');
  run('merge-brother.cjs');
  run('validate-brother.cjs');
  run('audit-brother.cjs');

  console.log('\nГотово! Результат: data/brother-compatibility.json');
  console.log('Основная база SQLite не изменена.');
} catch (error) {
  console.error('\nОшибка:', error.message);
  process.exitCode = 1;
}
