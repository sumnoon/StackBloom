#include <iostream>

struct Node {
    int key;
    Node* left;
    Node* right;
};

Node* insert(Node* node, int key) {
    if (node == nullptr) return new Node{key, nullptr, nullptr};
    if (key < node->key) node->left = insert(node->left, key);
    else node->right = insert(node->right, key);
    return node;
}

int sum(Node* node) {
    if (node == nullptr) return 0;
    return node->key + sum(node->left) + sum(node->right);
}

int main() {
    Node* root = nullptr;
    for (int key : {5, 3, 8, 4}) {
        root = insert(root, key);
    }
    std::cout << "sum=" << sum(root) << std::endl;
    return 0;
}
