import blah from '@config/blah';

export function isDomainUsername(username: string) {
  return username.length <= 253 && username.includes('.') && username.split('.').every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

// https://github.com/tdlib/td/blob/c95598e5e1493881d31211c1329bdbe4630f6136/td/telegram/misc.cpp#L246
export function isUsernameValid(username: string) {
  if(blah && username.includes('.')) return isDomainUsername(username);
  if(username.length < 3 || username.length > 32) {
    return false;
  }

  if(!/[a-zA-Z]/.test(username.charAt(0))) {
    return false;
  }

  for(let i = 0; i < username.length; i++) {
    const c = username.charAt(i);
    if(!/[a-zA-Z0-9_]/.test(c)) {
      return false;
    }
  }

  if(username.charAt(username.length - 1) === '_') {
    return false;
  }

  for(let i = 1; i < username.length; i++) {
    if(username.charAt(i - 1) === '_' && username.charAt(i) === '_') {
      return false;
    }
  }

  return true;
}

export function isWebAppNameValid(name: string) {
  return !name.includes('.') && name.length >= 3 && isUsernameValid(name);
}
