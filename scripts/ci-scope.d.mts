export function rootVersionOnly(before: string, after: string): boolean;
export function verificationScope(
  event: string,
  files?: string[],
  versionOnly?: boolean,
): {
  code: boolean;
  full: boolean;
  docker: boolean;
  docker_extended: boolean;
};
