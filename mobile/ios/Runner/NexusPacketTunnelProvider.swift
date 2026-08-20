import NetworkExtension

/// Заглушка PacketTunnelProvider для NEXUS Mobile.
///
/// Настоящий VPN-туннель на iOS строится через Network Extension target:
///  - отдельная цель «NexusTunnel» (extension) с этим классом как entry point;
///  - конфигурация NEVPNProtocolIKEv2 / NEVPNProtocolIPSec или кастомного
///    протокола (sing-box/Xray подключаются отдельно как библиотека);
///  - в entitlements должно быть разрешение packet-tunnel-provider.
class NexusPacketTunnelProvider: NEPacketTunnelProvider {

    override func startTunnel(options: [String: NSObject]? = nil, completionHandler: @escaping (Error?) -> Void) {
        // Пример: поднять локальный tun-интерфейс и запустить ядро.
        //
        // let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "10.0.0.2")
        // settings.ipv4Settings = NEIPv4Settings(addresses: ["10.0.0.1"], subnetMasks: ["255.255.255.0"])
        // setTunnelNetworkSettings(settings) { error in completionHandler(error) }
        completionHandler(nil)
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        completionHandler()
    }

    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        // Обработка команд из основного приложения (старт/стоп/статус).
        completionHandler?(nil)
    }
}
