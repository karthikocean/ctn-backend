export function parseAndValidateDob(dobInput: any): { date: Date | null; error?: string } {
  if (dobInput === undefined || dobInput === null || dobInput === " \) {
 return { date: null };
 }

 let date: Date;

 if (dobInput instanceof Date) {
 date = dobInput;
 } else if (typeof dobInput === \string\) {
 const cleanStr = dobInput.trim();
 if (!cleanStr) return { date: null };

 const ymdMatch = cleanStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
 if (ymdMatch) {
 const year = parseInt(ymdMatch[1], 10);
 const month = parseInt(ymdMatch[2], 10) - 1;
 const day = parseInt(ymdMatch[3], 10);
 date = new Date(year, month, day);
 } else {
 const dmyMatch = cleanStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
 if (dmyMatch) {
 const day = parseInt(dmyMatch[1], 10);
 const month = parseInt(dmyMatch[2], 10) - 1;
 const year = parseInt(dmyMatch[3], 10);
 date = new Date(year, month, day);
 } else {
 date = new Date(cleanStr);
 }
 }
 } else {
 return { date: null, error: \Invalid Date of Birth format\ };
 }

 if (isNaN(date.getTime())) {
 return { date: null, error: \Invalid Date of Birth date format\ };
 }

 const today = new Date();
 today.setHours(23, 59, 59, 999);
 if (date > today) {
 return { date: null, error: \Date of Birth cannot be in the future\ };
 }

 if (date.getFullYear() < 1900) {
 return { date: null, error: \Year of Birth must be 1900 or later\ };
 }

 return { date };
}
