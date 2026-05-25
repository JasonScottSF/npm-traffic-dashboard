package com.geeksville.mesh;
import com.geeksville.mesh.DataPacket;
import com.geeksville.mesh.NodeInfo;

oneway interface IMeshServiceObserver {
    void onReceive(in DataPacket p);
    void onNodeUpdate(in NodeInfo info);
}
