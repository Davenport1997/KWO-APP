/**
 * Data Export Service
 * Handles JSON exports and PDF generation for user data
 */

export interface ExportOptions {
  format: 'json' | 'pdf';
  includeChat: boolean;
  includeCheckIns: boolean;
  includeChallenges: boolean;
  includeJournal: boolean;
  includeAnalytics: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface ExportPayload {
  exportedAt: Date;
  userId: string;
  dataIncluded: string[];
  fileFormat: string;
  contentType: string;
}

/**
 * Generate JSON export of user data
 */
export function generateJSONExport(userData: any, options: ExportOptions): {
  content: string;
  filename: string;
  mimeType: string;
} {
  const exportData: any = {
    exportedAt: new Date().toISOString(),
    userId: userData.id,
    exportOptions: options,
    data: {},
  };

  // Include requested data sections
  if (options.includeChat && userData.chatHistory) {
    exportData.data.chatHistory = filterByDateRange(userData.chatHistory, options.dateRange);
  }

  if (options.includeCheckIns && userData.checkIns) {
    exportData.data.checkIns = filterByDateRange(userData.checkIns, options.dateRange);
  }

  if (options.includeChallenges && userData.challenges) {
    exportData.data.challenges = filterByDateRange(userData.challenges, options.dateRange);
  }

  if (options.includeJournal && userData.journalEntries) {
    exportData.data.journalEntries = filterByDateRange(userData.journalEntries, options.dateRange);
  }

  if (options.includeAnalytics && userData.analytics) {
    exportData.data.analytics = userData.analytics;
  }

  // Include user profile (always)
  exportData.userProfile = {
    id: userData.id,
    email: userData.email,
    name: userData.profile?.name,
    createdAt: userData.createdAt,
  };

  const content = JSON.stringify(exportData, null, 2);
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `kwo-data-export-${timestamp}.json`;

  return {
    content,
    filename,
    mimeType: 'application/json',
  };
}

/**
 * Generate CSV format for spreadsheet applications
 */
export function generateCSVExport(userData: any, options: ExportOptions): {
  content: string;
  filename: string;
  mimeType: string;
} {
  let csv = '';
  const sections: string[] = [];

  // Chat History CSV
  if (options.includeChat && userData.chatHistory) {
    const chatData = filterByDateRange(userData.chatHistory, options.dateRange);
    if (chatData.length > 0) {
      csv += 'CHAT HISTORY\n';
      csv += 'Date,Time,Sender,Message\n';

      chatData.forEach((msg: any) => {
        const date = new Date(msg.timestamp);
        const dateStr = date.toLocaleDateString();
        const timeStr = date.toLocaleTimeString();
        const sender = msg.sender || 'User';
        const message = escapeCSV(msg.content);

        csv += `"${dateStr}","${timeStr}","${sender}","${message}"\n`;
      });

      csv += '\n\n';
      sections.push('Chat History');
    }
  }

  // Check-ins CSV
  if (options.includeCheckIns && userData.checkIns) {
    const checkIns = filterByDateRange(userData.checkIns, options.dateRange);
    if (checkIns.length > 0) {
      csv += 'CHECK-INS\n';
      csv += 'Date,Time,Mood,Notes\n';

      checkIns.forEach((checkin: any) => {
        const date = new Date(checkin.timestamp);
        const dateStr = date.toLocaleDateString();
        const timeStr = date.toLocaleTimeString();
        const mood = checkin.mood || '';
        const notes = escapeCSV(checkin.notes || '');

        csv += `"${dateStr}","${timeStr}","${mood}","${notes}"\n`;
      });

      csv += '\n\n';
      sections.push('Check-Ins');
    }
  }

  // Challenges CSV
  if (options.includeChallenges && userData.challenges) {
    const challenges = filterByDateRange(userData.challenges, options.dateRange);
    if (challenges.length > 0) {
      csv += 'CHALLENGES\n';
      csv += 'Date,Challenge,Status,Notes\n';

      challenges.forEach((challenge: any) => {
        const date = new Date(challenge.completedAt || challenge.createdAt);
        const dateStr = date.toLocaleDateString();
        const name = challenge.name || '';
        const status = challenge.completed ? 'Completed' : 'Incomplete';
        const notes = escapeCSV(challenge.notes || '');

        csv += `"${dateStr}","${name}","${status}","${notes}"\n`;
      });

      csv += '\n\n';
      sections.push('Challenges');
    }
  }

  // Journal Entries CSV
  if (options.includeJournal && userData.journalEntries) {
    const entries = filterByDateRange(userData.journalEntries, options.dateRange);
    if (entries.length > 0) {
      csv += 'JOURNAL ENTRIES\n';
      csv += 'Date,Time,Content\n';

      entries.forEach((entry: any) => {
        const date = new Date(entry.timestamp);
        const dateStr = date.toLocaleDateString();
        const timeStr = date.toLocaleTimeString();
        const content = escapeCSV(entry.content);

        csv += `"${dateStr}","${timeStr}","${content}"\n`;
      });

      csv += '\n\n';
      sections.push('Journal Entries');
    }
  }

  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `kwo-data-export-${timestamp}.csv`;

  return {
    content: csv,
    filename,
    mimeType: 'text/csv',
  };
}

/**
 * Generate HTML summary (lightweight PDF alternative)
 */
export function generateHTMLExport(userData: any, options: ExportOptions): {
  content: string;
  filename: string;
  mimeType: string;
} {
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>KWO Data Export</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      color: #333;
      background: #f5f5f5;
    }
    .header {
      background: #7A8F62;
      color: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    .section {
      background: white;
      padding: 20px;
      margin-bottom: 20px;
      border-radius: 8px;
      border-left: 4px solid #7A8F62;
    }
    .section h2 {
      margin-top: 0;
      color: #7A8F62;
    }
    .entry {
      padding: 15px;
      margin-bottom: 10px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      background: #fafafa;
    }
    .timestamp {
      color: #666;
      font-size: 0.9em;
      font-weight: 500;
    }
    .content {
      margin-top: 8px;
      line-height: 1.5;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    th, td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    th {
      background: #f0f0f0;
      font-weight: 600;
    }
    @media print {
      body { background: white; }
      .section { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>KWO Recovery Data Export</h1>
    <p>Exported on ${new Date().toLocaleString()}</p>
  </div>

  <div class="section">
    <h2>User Information</h2>
    <table>
      <tr>
        <th>Field</th>
        <th>Value</th>
      </tr>
      <tr>
        <td>User ID</td>
        <td>${escapeHTML(userData.id)}</td>
      </tr>
      <tr>
        <td>Email</td>
        <td>${escapeHTML(userData.email)}</td>
      </tr>
      <tr>
        <td>Account Created</td>
        <td>${new Date(userData.createdAt).toLocaleString()}</td>
      </tr>
    </table>
  </div>
`;

  // Add Chat History
  if (options.includeChat && userData.chatHistory) {
    const chatData = filterByDateRange(userData.chatHistory, options.dateRange);
    if (chatData.length > 0) {
      html += '<div class="section"><h2>Chat History</h2>';
      chatData.forEach((msg: any) => {
        const date = new Date(msg.timestamp);
        html += `
        <div class="entry">
          <div class="timestamp">${date.toLocaleString()}</div>
          <div class="content">${escapeHTML(msg.content)}</div>
        </div>
        `;
      });
      html += '</div>';
    }
  }

  // Add Check-Ins
  if (options.includeCheckIns && userData.checkIns) {
    const checkIns = filterByDateRange(userData.checkIns, options.dateRange);
    if (checkIns.length > 0) {
      html += '<div class="section"><h2>Check-Ins</h2><table><tr><th>Date</th><th>Mood</th><th>Notes</th></tr>';
      checkIns.forEach((checkin: any) => {
        const date = new Date(checkin.timestamp);
        html += `<tr><td>${date.toLocaleString()}</td><td>${escapeHTML(checkin.mood || '')}</td><td>${escapeHTML(checkin.notes || '')}</td></tr>`;
      });
      html += '</table></div>';
    }
  }

  // Add Journal Entries
  if (options.includeJournal && userData.journalEntries) {
    const entries = filterByDateRange(userData.journalEntries, options.dateRange);
    if (entries.length > 0) {
      html += '<div class="section"><h2>Journal Entries</h2>';
      entries.forEach((entry: any) => {
        const date = new Date(entry.timestamp);
        html += `
        <div class="entry">
          <div class="timestamp">${date.toLocaleString()}</div>
          <div class="content">${escapeHTML(entry.content)}</div>
        </div>
        `;
      });
      html += '</div>';
    }
  }

  html += '</body></html>';

  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `kwo-data-export-${timestamp}.html`;

  return {
    content: html,
    filename,
    mimeType: 'text/html',
  };
}

/**
 * Filter data by date range
 */
function filterByDateRange(data: any[], dateRange?: { start: Date; end: Date }): any[] {
  if (!dateRange) {
    return data;
  }

  const startTime = new Date(dateRange.start).getTime();
  const endTime = new Date(dateRange.end).getTime();

  return data.filter((item) => {
    const itemTime = new Date(item.timestamp || item.createdAt).getTime();
    return itemTime >= startTime && itemTime <= endTime;
  });
}

/**
 * Escape CSV special characters
 */
function escapeCSV(str: string): string {
  if (!str) return '';
  return str.replace(/"/g, '""');
}

/**
 * Escape HTML special characters
 */
function escapeHTML(str: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return str.replace(/[&<>"']/g, (char) => map[char]);
}
