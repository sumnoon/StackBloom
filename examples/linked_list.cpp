#include <iostream>

struct Node {
    int value;
    Node* next;
};

int main() {
    Node* head = new Node{1, nullptr};
    head->next = new Node{2, nullptr};
    head->next->next = new Node{3, nullptr};

    Node* alias = head->next;   // a second pointer to one node
    int total = 0;
    for (Node* walk = head; walk != nullptr; walk = walk->next) {
        total += walk->value;
    }
    std::cout << "total=" << total << " alias=" << alias->value << std::endl;

    Node* stale = head;
    delete head;                // stale now dangles
    head = nullptr;
    std::cout << "freed the head" << std::endl;
    return total;
}
