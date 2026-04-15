import json, time

with open('drizzle/meta/_journal.json', 'r') as f:
    j = json.load(f)

existing_tags = {e['tag'] for e in j['entries']}

new_migrations = [
    '0015_github_sync_migration',
    '0016_add_city',
    '0017_add_state',
    '0018_add_vgv',
    '0019_add_financed_amount',
    '0020_add_fgts_amount',
    '0021_add_subsidy_amount',
    '0022_add_down_payment',
    '0023_create_lead_follow_ups',
]

ts = int(time.time() * 1000)
for i, tag in enumerate(new_migrations):
    if tag not in existing_tags:
        idx = len(j['entries'])
        j['entries'].append({
            'idx': idx,
            'version': '7',
            'when': ts + i,
            'tag': tag,
            'breakpoints': True
        })
        print(f"Added: {tag} (idx={idx})")
    else:
        print(f"Already exists: {tag}")

with open('drizzle/meta/_journal.json', 'w') as f:
    json.dump(j, f, indent=2)

print(f"\nTotal entries: {len(j['entries'])}")
