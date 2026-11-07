import cn.evolution.studyboard.ConnectionInfo;

public class ConnectionInfoTest {
    public static void main(String[] args) {
        String key = new String(new char[64]).replace('\0', 'a');
        String host = "https://study.example.ts.net:8450";
        ConnectionInfo setup = ConnectionInfo.parse("接入说明：\n"+host+"/mobile/"+key+"/setup.txt");
        if(!host.equals(setup.origin)||!key.equals(setup.token)||!setup.board.isEmpty())throw new AssertionError("setup link");
        ConnectionInfo board = ConnectionInfo.parse(host+"/c/canvas-ab1234/"+key+"/");
        if(!"canvas-ab1234".equals(board.board)||!board.boardUrl(board.board).equals(host+"/c/canvas-ab1234/"+key+"/"))throw new AssertionError("board link");
        ConnectionInfo classroom = ConnectionInfo.parse(host+"/classroom/canvas-ab1234/"+key+"/");
        if(!"canvas-ab1234".equals(classroom.board)||!classroom.classroomUrl(classroom.board).equals(host+"/classroom/canvas-ab1234/"+key+"/"))throw new AssertionError("classroom link");
        reject("http://study.example.ts.net:8450/mobile/"+key+"/setup.txt");
        reject("https://unrelated.example/mobile/"+key+"/setup.txt");
        reject(host+"/mobile/short-token/setup.txt");
        try{board.boardUrl("../other");throw new AssertionError("traversal accepted");}catch(IllegalArgumentException expected){}
        System.out.println("PASS: 接入说明/白板链接解析；明文、错误域名、不完整凭据、路径越界拒绝");
    }
    static void reject(String text){try{ConnectionInfo.parse(text);throw new AssertionError("invalid link accepted");}catch(IllegalArgumentException expected){}}
}
