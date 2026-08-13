import '../config/api_config.dart';
import 'auth_service.dart';
import 'socket_service.dart';

class DriverSessionManager {
  static Future<bool> restore() async {
    final hasSession = await AuthService.rehydrateStoredSession(
      refreshProfile: false,
    );
    if (!hasSession) return false;

    final socket = SocketService();
    await socket.connect(ApiConfig.socketUrl);

    final activeTripId = await AuthService.getActiveTripId();
    if (activeTripId != null && activeTripId.isNotEmpty) {
      socket.setActiveTrip(activeTripId);
    }

    return true;
  }
}
