package com.geeksville.mesh;
import com.geeksville.mesh.DataPacket;
import com.geeksville.mesh.NodeInfo;
import com.geeksville.mesh.IMeshServiceObserver;

interface IMeshService {
    String getMyId();
    NodeInfo getMyNodeInfo();
    List<NodeInfo> getNodes();
    void send(in DataPacket p);
    void registerObserver(in IMeshServiceObserver o);
    void unregisterObserver(in IMeshServiceObserver o);
}
