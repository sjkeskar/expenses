// Confirmed password policy: minimum 6 characters, at least one number,
// at least one special character.
const SPECIAL_CHAR_REGEX = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;
const NUMBER_REGEX = /[0-9]/;

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 6) {
    return "Password must be at least 6 characters long.";
  }
  if (!NUMBER_REGEX.test(password)) {
    return "Password must contain at least one number.";
  }
  if (!SPECIAL_CHAR_REGEX.test(password)) {
    return "Password must contain at least one special character.";
  }
  return null; // null = valid
}

module.exports = { validatePassword };
