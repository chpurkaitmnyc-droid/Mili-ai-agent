/**
 * Converts numbers into Bengali currency words for smooth pronunciation.
 */
function convertAmountToBengaliWords(amount) {
  const units = ["", "এক", "দুই", "তিন", "চার", "পাঁচ", "ছয়", "সাত", "আট", "নয়"];
  const teens = [
    "দশ", "এগারো", "বারো", "তেরো", "চৌদ্দ", "পনেরো",
    "ষোলো", "সতেরো", "আঠারো", "উনিশ",
  ];
  const tens = [
    "", "", "বিশ", "তিরিশ", "চল্লিশ", "পঞ্চাশ",
    "ষাট", "সত্তর", "আশি", "নব্বই",
  ];

  const num = Number(amount);
  if (!num || isNaN(num) || num <= 0) return "কিছু টাকা";

  let words = "";
  const thousands = Math.floor(num / 1000);
  const remainder = num % 1000;

  if (thousands > 0) {
    if (thousands === 1) words += "এক হাজার";
    else if (thousands < 10) words += `${units[thousands]} হাজার`;
    else words += `${thousands} হাজার`;
  }

  const hundreds = Math.floor(remainder / 100);
  const lastTwo = remainder % 100;

  if (hundreds > 0) {
    if (words) words += " ";
    if (hundreds === 1) words += "একশো";
    else if (hundreds === 5) words += "পাঁচশো";
    else words += `${units[hundreds]}শো`;
  }

  if (lastTwo > 0) {
    if (words) words += " ";
    if (lastTwo < 10) {
      words += units[lastTwo];
    } else if (lastTwo < 20) {
      words += teens[lastTwo - 10];
    } else {
      const tensDigit = Math.floor(lastTwo / 10);
      const unitsDigit = lastTwo % 10;
      words += tens[tensDigit];
      if (unitsDigit > 0) words += ` ${units[unitsDigit]}`;
    }
  }

  return `${words.trim()} টাকা`;
}

module.exports = {
  convertAmountToBengaliWords,
};
