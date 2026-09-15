export type DataFileFormat = 'csv' | 'json';

export interface DataFileError {
  line: number;
  message: string;
}

export interface ParsedDataFile {
  rows: Record<string, any>[];
  errors: DataFileError[];
}

interface CsvRecord {
  fields: string[];
  line: number;
  unterminated?: boolean;
}

// RFC 4180 record reader: quote-enclosed fields may contain commas, newlines
// and escaped quotes (""). Records are split on CRLF / LF / CR outside quotes.
const readCsvRecords = (content: string): CsvRecord[] => {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;
  let line = 1;
  let recordStartLine = 1;
  let i = 0;

  const pushField = () => {
    fields.push(field);
    field = '';
    fieldWasQuoted = false;
  };

  const pushRecord = () => {
    // a completely empty line is a record separator, not a one-field record
    if (fields.length === 0 && field === '' && !fieldWasQuoted) {
      recordStartLine = line;
      return;
    }
    pushField();
    records.push({ fields, line: recordStartLine });
    fields = [];
    recordStartLine = line;
  };

  while (i < content.length) {
    const char = content[i];

    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (char === '\n' || char === '\r') line++;
      field += char;
      i++;
      continue;
    }

    if (char === '"' && field === '' && !fieldWasQuoted) {
      inQuotes = true;
      fieldWasQuoted = true;
      i++;
      continue;
    }
    if (char === ',') {
      pushField();
      i++;
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && content[i + 1] === '\n') i++;
      i++;
      line++;
      pushRecord();
      continue;
    }
    field += char;
    i++;
  }

  if (inQuotes) {
    return [...records, { fields: [], line: recordStartLine, unterminated: true }];
  }
  if (field !== '' || fields.length > 0) pushRecord();
  return records;
};

const parseCsv = (content: string): ParsedDataFile => {
  const clean = content.startsWith(String.fromCharCode(0xfeff))
    ? content.slice(1)
    : content;
  const records = readCsvRecords(clean);

  const lastRecord = records[records.length - 1];
  if (lastRecord?.unterminated) {
    return {
      rows: [],
      errors: [{ line: lastRecord.line, message: `Unterminated quoted field starting at line ${lastRecord.line}` }]
    };
  }
  if (records.length === 0) {
    return { rows: [], errors: [] };
  }

  const headerRecord = records[0];
  const header = headerRecord.fields;
  const errors: DataFileError[] = [];
  header.forEach((name, index) => {
    if (name.trim() === '') {
      errors.push({ line: headerRecord.line, message: `Column ${index + 1} has an empty header name` });
    }
  });
  if (errors.length) {
    return { rows: [], errors };
  }

  // a data row shorter than the header leaves those keys absent (undefined,
  // distinct from an empty cell which parses as ''); extra cells are ignored
  const rows = records.slice(1).map((record) => {
    const row: Record<string, any> = {};
    header.forEach((name, index) => {
      if (index < record.fields.length) {
        row[name] = record.fields[index];
      }
    });
    return row;
  });

  return { rows, errors: [] };
};

const parseJson = (content: string): ParsedDataFile => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return { rows: [], errors: [{ line: 0, message: `Invalid JSON: ${(err as Error).message}` }] };
  }
  if (!Array.isArray(parsed)) {
    return { rows: [], errors: [{ line: 0, message: 'JSON data file must be an array of objects' }] };
  }
  const badIndex = parsed.findIndex((entry) => typeof entry !== 'object' || entry === null || Array.isArray(entry));
  if (badIndex >= 0) {
    return {
      rows: [],
      errors: [{ line: 0, message: `JSON array element at index ${badIndex} must be an object` }]
    };
  }
  return { rows: parsed as Record<string, any>[], errors: [] };
};

export const parseDataFile = (content: string, format: DataFileFormat): ParsedDataFile => {
  if (format === 'json') {
    return parseJson(content);
  }
  return parseCsv(content);
};
