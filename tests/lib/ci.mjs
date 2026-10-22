import fs from 'node:fs';

// Keep the actual failure visible in Actions annotations and summaries, even when full logs
// and artifacts require sign-in. These runners use only the public game and synthetic profiles.
export function reportFailure(title, detail) {
    const text = String(detail).slice(0, 14000);
    console.error(`${title}\n${text}`);
    if (process.env.GITHUB_ACTIONS !== 'true') return;
    const escape = value => value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.error(`::error title=${escape(title).replace(/,/g, '%2C').replace(/:/g, '%3A')}::${escape(text)}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### ${title}\n\n\`\`\`text\n${text}\n\`\`\`\n`);
    }
}
