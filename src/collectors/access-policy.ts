export interface AccessPolicy { delayMs: number; startMinute?: number; endMinute?: number; disallow: string[] }
export function parseRobots(text: string): AccessPolicy {
  const groups: Array<{ agents: string[]; lines: Array<[string, string]> }> = [];
  let group: typeof groups[number] | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const match = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!match) throw new Error('Unrecognized robots policy');
    const [, rawKey, value] = match;
    const key = rawKey.toLowerCase();
    if (key === 'sitemap') continue;
    if (key === 'user-agent') {
      if (!group || group.lines.length) { group = { agents: [], lines: [] }; groups.push(group); }
      group.agents.push(value.toLowerCase());
    } else {
      if (!group) throw new Error('Robots directive without user agent');
      group.lines.push([key, value]);
    }
  }
  const applicable = groups.filter(item => item.agents.includes('*') || item.agents.some(agent => agent.includes('printcartridge')));
  if (!applicable.length) throw new Error('No recognized robots policy');
  const policy: AccessPolicy = { delayMs: 10_000, disallow: [] };
  for (const [key, value] of applicable.flatMap(item => item.lines)) {
    if (key === 'disallow' && value) policy.disallow.push(value);
    else if (key === 'crawl-delay') {
      if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('Invalid crawl delay');
      policy.delayMs = Math.max(policy.delayMs, Number(value) * 1000);
    } else if (key === 'request-rate') {
      const match = /^(\d+)\/(\d+)$/.exec(value);
      if (!match || Number(match[1]) === 0) throw new Error('Unsupported request rate');
      policy.delayMs = Math.max(policy.delayMs, Number(match[2]) * 1000 / Number(match[1]));
    } else if (key === 'visit-time') {
      const match = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(value);
      if (!match || Number(match[1]) > 23 || Number(match[3]) > 23 || Number(match[2]) > 59 || Number(match[4]) > 59) throw new Error('Invalid visit time');
      if (policy.startMinute !== undefined) throw new Error('Multiple visit windows need review');
      policy.startMinute = Number(match[1]) * 60 + Number(match[2]);
      policy.endMinute = Number(match[3]) * 60 + Number(match[4]);
    } else if (!['allow', 'disallow'].includes(key)) throw new Error(`Unsupported robots directive: ${key}`);
  }
  return policy;
}

export function accessReason(policy: AccessPolicy, url: string, now: Date): string | undefined {
  const path = new URL(url).pathname;
  if (policy.disallow.some(rule => {
    const pattern = rule.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$');
    return new RegExp(`^${pattern}`).test(path);
  })) return 'robots-disallow';
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (policy.startMinute !== undefined && policy.endMinute !== undefined) {
    const allowed = policy.startMinute <= policy.endMinute
      ? minute >= policy.startMinute && minute < policy.endMinute
      : minute >= policy.startMinute || minute < policy.endMinute;
    if (!allowed) return 'outside-robots-visit-window';
  }
  return undefined;
}
