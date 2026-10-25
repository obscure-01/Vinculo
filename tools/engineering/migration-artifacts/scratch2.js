const fs = require('fs');
let content = fs.readFileSync('public/js/admin.js', 'utf8');

// Replace badge rendering in progressModal tasks list
content = content.replace(/let badgeClass = 'bg-surface-container-high text-on-surface-variant';\s*if \(task\.status === 'COMPLETED'\) {\s*badgeClass = 'bg-tertiary-container text-on-tertiary-container border border-tertiary-fixed';\s*} else if \(task\.status === 'OPENED'\) {\s*badgeClass = 'bg-amber-100 text-amber-800 border border-amber-200';\s*}/g,
`let badgeStatus = 'neutral';
                if (task.status === 'COMPLETED') badgeStatus = 'success';
                else if (task.status === 'OPENED') badgeStatus = 'warning';`);

content = content.replace(/<span class="inline-flex px-2 py-0\.5 rounded text-\[10px\] font-semibold \$\{badgeClass\}">\s*\$\{task\.status\}\s*<\/span>/g,
'${UI.Badge.render({ status: badgeStatus, text: task.status })}');

// Replace badge rendering in verification logs
content = content.replace(/<span class="inline-flex px-2 py-0\.5 rounded text-\[10px\] font-semibold \$\{statusBadge\}">\$\{log\.status\}<\/span>/g,
'${UI.Badge.render({ status: log.status === "VERIFIED" ? "success" : log.status === "PENDING" ? "warning" : "neutral", text: log.status })}');

fs.writeFileSync('public/js/admin.js', content);
console.log('Regex replacements applied.');
