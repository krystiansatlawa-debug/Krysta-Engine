/** User-facing Google OAuth diagnostics. Never include token endpoint response bodies or secrets. */
export function googleOAuthTokenError(code: string, status: number): string {
 switch (code) {
  case "invalid_client": case "deleted_client": case "disabled_client":
   return "Google OAuth ("+code+", HTTP "+status+"): nieprawidłowy lub nieaktywny klient OAuth Desktop. Sprawdź Client ID i Client Secret tej samej aplikacji w Google Cloud, a następnie wczytaj poprawny plik JSON klienta Desktop w ustawieniach Krysty. / Invalid Desktop OAuth client configuration.";
  case "invalid_grant":
   return "Google OAuth (invalid_grant): dostęp wygasł lub został cofnięty. Połącz konto Google ponownie. / Please reconnect Google.";
  case "unauthorized_client":
   return "Google OAuth (unauthorized_client): klient nie może użyć tej metody logowania. W Google Cloud wybierz typ Desktop. / Desktop app client required.";
  case "invalid_scope":
   return "Google OAuth (invalid_scope): uprawnienia Google Drive nie są włączone lub zaakceptowane. / Google Drive scope is unavailable.";
  case "access_denied":
   return "Google OAuth (access_denied): konto nie ma dostępu do tej aplikacji. Jeśli aplikacja jest w trybie Testing, dodaj użytkownika testowego w Google Cloud. / Check OAuth test users.";
  case "invalid_request":
   return "Google OAuth (invalid_request): żądanie zostało odrzucone. Sprawdź klienta Desktop i adres powrotny 127.0.0.1. / Check desktop client and loopback redirect.";
 }
 if(status===401)return "Google OAuth (HTTP 401): sprawdź identyfikator klienta OAuth Desktop w Google Cloud. / Invalid OAuth client.";
 if(status===403)return "Google OAuth (HTTP 403): dostęp zabroniony. Sprawdź użytkowników testowych, zgodę OAuth i dostęp do Drive API. / Access forbidden.";
 return "Google OAuth: logowanie nie powiodło się (HTTP "+status+"). / Authorization failed.";
}
export function googleOAuthCallbackError(code:string):string {
 if(code==="access_denied")return "Logowanie anulowane lub odmówiono dostępu do Google Drive. / Sign-in cancelled or access denied.";
 if(code==="org_internal")return "Aplikacja Google jest ograniczona do organizacji. / Google app is restricted to an organization.";
 if(code==="admin_policy_enforced")return "Administrator konta Google zablokował dostęp. / Google Workspace policy blocked access.";
 return "Google nie zakończył autoryzacji. Sprawdź ustawienia OAuth i spróbuj ponownie. / Google authorization failed.";
}
export function validateGoogleDesktopClient(id:unknown,secret:unknown):{client_id:string;client_secret:string}{
 if(typeof id!=="string"||typeof secret!=="string")throw Error("Brak konfiguracji OAuth Desktop / Desktop OAuth configuration missing");
 const client_id=id.trim(),client_secret=secret.trim();
 if(!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(client_id)||!client_secret||/\s/.test(client_secret)||client_secret.length>512)
  throw Error("Nieprawidłowa konfiguracja OAuth Desktop / Invalid desktop OAuth configuration");
 return {client_id,client_secret};
}
