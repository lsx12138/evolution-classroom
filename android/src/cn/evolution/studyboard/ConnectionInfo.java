package cn.evolution.studyboard;

import java.net.URI;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Parses only the explicitly shared Tailscale classroom links; never ships a credential. */
public final class ConnectionInfo {
    public final String origin;
    public final String token;
    public final String board;
    private static final Pattern LINK = Pattern.compile("https://[a-zA-Z0-9.-]+(?::[0-9]{1,5})?/(?:mobile/[a-f0-9]{64}/setup\\.txt|(?:c|classroom)/[a-z0-9][a-z0-9-]{0,63}/[a-f0-9]{64}/?)");
    public ConnectionInfo(String origin, String token, String board) {
        URI uri = URI.create(origin);
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || !uri.getHost().endsWith(".ts.net") || uri.getUserInfo() != null || uri.getPort() > 65535) {
            throw new IllegalArgumentException("请使用你自己的 Tailscale HTTPS 接入链接。");
        }
        if (!token.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("接入信息不完整，请重新复制整个链接。");
        if (board != null && !board.isEmpty() && !board.matches("[a-z0-9][a-z0-9-]{0,63}")) throw new IllegalArgumentException("白板编号不正确。");
        this.origin = uri.getScheme() + "://" + uri.getRawAuthority();
        this.token = token;
        this.board = board == null ? "" : board;
    }
    public static ConnectionInfo parse(String text) {
        Matcher match = LINK.matcher(text == null ? "" : text);
        if (!match.find()) throw new IllegalArgumentException("复制老师给你的完整接入链接后，再点“粘贴接入链接”。");
        URI uri = URI.create(match.group());
        String[] parts = uri.getPath().split("/");
        boolean boardLink = "c".equals(parts[1]) || "classroom".equals(parts[1]);
        return new ConnectionInfo(uri.getScheme() + "://" + uri.getRawAuthority(), parts[boardLink ? 3 : 2], boardLink ? parts[2] : "");
    }
    public String boardUrl(String id) {
        if (!id.matches("[a-z0-9][a-z0-9-]{0,63}")) throw new IllegalArgumentException("无效白板编号");
        return origin + "/c/" + id + "/" + token + "/";
    }
    public String classroomUrl(String id) {
        if (!id.matches("[a-z0-9][a-z0-9-]{0,63}")) throw new IllegalArgumentException("无效白板编号");
        return origin + "/classroom/" + id + "/" + token + "/";
    }
}
