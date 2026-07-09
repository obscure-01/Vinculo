const fs = require('fs');
let content = fs.readFileSync('public/js/admin.js', 'utf8');

// Replace badgeClass block 749-753
content = content.replace(/let badgeClass = 'bg-surface-container-high text-on-surface-variant';\s*if \(record\.status === 'VERIFIED'\) {\s*badgeClass = 'bg-tertiary-container text-on-tertiary-container border border-tertiary-fixed';\s*} else if \(record\.status === 'PENDING'\) {\s*badgeClass = 'bg-amber-100 text-amber-800 border border-amber-200';\s*}/g,
`let badgeStatus = 'neutral';
            if (record.status === 'VERIFIED') badgeStatus = 'success';
            else if (record.status === 'PENDING') badgeStatus = 'warning';`);

// Replace its usage
content = content.replace(/<span class="inline-flex px-2 py-0\.5 rounded text-\[10px\] font-semibold \$\{badgeClass\}">\s*\$\{record\.status\}\s*<\/span>/g,
'${UI.Badge.render({ status: badgeStatus, text: record.status })}');

// Replace commentBadgeClass block 1
content = content.replace(/let commentBadgeClass = 'bg-surface-container-high text-secondary';\s*if \(record\.comment_status === 'VERIFIED'\) {\s*commentBadgeClass = 'bg-tertiary-container text-on-tertiary-container border border-tertiary-fixed';\s*} else if \(record\.comment_status === 'REJECTED'\) {\s*commentBadgeClass = 'bg-error-container text-on-error-container border border-\\[#fbdfe1\\]';\s*} else if \(record\.comment_status === 'PENDING'\) {\s*commentBadgeClass = 'bg-secondary-container text-on-secondary-container border border-outline-variant';\s*}/g,
`let commentBadgeStatus = 'neutral';
            if (record.comment_status === 'VERIFIED') commentBadgeStatus = 'success';
            else if (record.comment_status === 'REJECTED') commentBadgeStatus = 'error';
            else if (record.comment_status === 'PENDING') commentBadgeStatus = 'info';`);

// Replace its usage 1
content = content.replace(/<span class="inline-flex px-2 py-0\.5 rounded text-\[10px\] font-semibold \$\{commentBadgeClass\}">\s*\$\{record\.comment_status\}\s*<\/span>/g,
'${UI.Badge.render({ status: commentBadgeStatus, text: record.comment_status })}');

// Replace commentBadgeClass block 2
content = content.replace(/let commentBadgeClass = 'bg-surface-container-high text-secondary';\s*if \(record\.status === 'VERIFIED'\) {\s*commentBadgeClass = 'bg-tertiary-container text-on-tertiary-container border border-tertiary-fixed';\s*} else if \(record\.status === 'REJECTED'\) {\s*commentBadgeClass = 'bg-error-container text-on-error-container border border-\\[#fbdfe1\\]';\s*} else if \(record\.status === 'PENDING'\) {\s*commentBadgeClass = 'bg-secondary-container text-on-secondary-container border border-outline-variant';\s*} else if \(record\.status === 'FAILED'\) {\s*commentBadgeClass = 'bg-error-container text-on-error-container border border-error\/20';\s*} else if \(record\.status === 'UNKNOWN'\) {\s*commentBadgeClass = 'bg-surface-container-high text-secondary';\s*}/g,
`let commentBadgeStatus = 'neutral';
            if (record.status === 'VERIFIED') commentBadgeStatus = 'success';
            else if (record.status === 'REJECTED' || record.status === 'FAILED') commentBadgeStatus = 'error';
            else if (record.status === 'PENDING') commentBadgeStatus = 'info';`);

// Replace its usage 2
content = content.replace(/<span class="inline-flex px-2 py-0\.5 rounded text-\[10px\] font-semibold \$\{commentBadgeClass\}">\s*\$\{record\.status\}\s*<\/span>/g,
'${UI.Badge.render({ status: commentBadgeStatus, text: record.status })}');

fs.writeFileSync('public/js/admin.js', content);
console.log('Regex replacements applied for badges.');
