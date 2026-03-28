function findPath(startNodeId, targetNodeId, paths) {
    if (startNodeId === targetNodeId) return [startNodeId];

    const adj = {};
    paths.forEach(pathStr => {
        const [u, v] = pathStr.split('_');
        if (!adj[u]) adj[u] = [];
        if (!adj[v]) adj[v] = [];
        adj[u].push(v);
    });

    const queue = [[startNodeId]];
    const visited = new Set([startNodeId]);

    while (queue.length > 0) {
        const path = queue.shift();
        const node = path[path.length - 1];

        if (node === targetNodeId) return path.slice(1);

        if (adj[node]) {
            for (const neighbor of adj[node]) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push([...path, neighbor]);
                }
            }
        }
    }
    return null;
}

module.exports = { findPath };
