// Standard Bug Sheet row, completed with the Jira key returned by the create call.
const src = $('Validate Bug JSON').item.json;
const key = $input.item.json.key;
const today = $now.setZone('Asia/Karachi').toFormat('yyyy-MM-dd');
return { json: { ...src.bug.sheet_row, 'Bug ID': key, 'Jira Key': key, 'Status': 'Open', 'Reported Date': src.bug.sheet_row['Reported Date'] && !/Y/.test(src.bug.sheet_row['Reported Date']) ? src.bug.sheet_row['Reported Date'] : today, 'Source Ticket': src.ticket, 'CI Run': src.run_url, 'Build': src.head_sha } };
