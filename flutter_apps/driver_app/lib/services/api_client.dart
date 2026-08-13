import 'package:http/http.dart' as http;
import 'auth_service.dart';

typedef DriverAuthenticatedRequest = Future<http.Response> Function(
  Map<String, String> headers,
);

class ApiClient {
  const ApiClient();

  Future<http.Response> request(
    DriverAuthenticatedRequest send, {
    required bool isActiveTrip,
    String source = 'driver_api_client',
  }) async {
    var headers = await AuthService.getHeaders();
    var response = await send(headers);

    if (response.statusCode == 401) {
      final refreshed = await AuthService.refreshOnce();
      if (refreshed) {
        headers = await AuthService.getHeaders();
        response = await send(headers);
      }

      if (response.statusCode == 401) {
        await AuthService.handle401(
          source: source,
          allowDuringActiveTrip: isActiveTrip,
        );
      }
    }

    return response;
  }
}
