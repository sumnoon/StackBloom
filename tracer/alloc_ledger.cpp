// Linked into every traced program. Records heap extents in a fixed ring buffer
// that the GDB recorder reads directly at each stop: no breakpoints, no inferior
// function calls. Replacing global operator new/delete is standard C++; direct
// malloc-family calls from the submitted source arrive through `ld --wrap`.
// Over-aligned (std::align_val_t) allocations are deliberately left untracked.
#include <cstddef>
#include <cstdlib>
#include <new>

extern "C" {
struct cppv_ledger_event {
    unsigned long long kind;  // 1 = allocation, 2 = release
    unsigned long long address;
    unsigned long long size;
};

// Read by tracer/memory.py. Single-threaded by design (threads stop the trace).
cppv_ledger_event cppv_ledger_events[1 << 16];
volatile unsigned long long cppv_ledger_count = 0;

void* __real_malloc(std::size_t size);
void* __real_calloc(std::size_t count, std::size_t size);
void* __real_realloc(void* pointer, std::size_t size);
void __real_free(void* pointer);
}

namespace {
const unsigned long long capacity = sizeof(cppv_ledger_events) / sizeof(cppv_ledger_events[0]);

void record(unsigned long long kind, void* pointer, std::size_t size) {
    if (!pointer) return;
    cppv_ledger_event& event = cppv_ledger_events[cppv_ledger_count % capacity];
    event.kind = kind;
    event.address = reinterpret_cast<unsigned long long>(pointer);
    event.size = size;
    cppv_ledger_count = cppv_ledger_count + 1;
}

void* allocate(std::size_t size) {
    if (size == 0) size = 1;
    for (;;) {
        if (void* pointer = __real_malloc(size)) {
            record(1, pointer, size);
            return pointer;
        }
        std::new_handler handler = std::get_new_handler();
        if (!handler) throw std::bad_alloc();
        handler();
    }
}

void* allocate_nothrow(std::size_t size) noexcept {
    try {
        return allocate(size);
    } catch (...) {
        return nullptr;
    }
}

void release(void* pointer) noexcept {
    record(2, pointer, 0);
    __real_free(pointer);
}
}  // namespace

extern "C" {
void* __wrap_malloc(std::size_t size) {
    void* pointer = __real_malloc(size);
    record(1, pointer, size ? size : 1);
    return pointer;
}

void* __wrap_calloc(std::size_t count, std::size_t size) {
    void* pointer = __real_calloc(count, size);
    record(1, pointer, count && size ? count * size : 1);
    return pointer;
}

void* __wrap_realloc(void* pointer, std::size_t size) {
    void* result = __real_realloc(pointer, size);
    // Success retires the old block; failure preserves it (except size 0).
    if (result || size == 0) record(2, pointer, 0);
    record(1, result, size ? size : 1);
    return result;
}

void __wrap_free(void* pointer) { release(pointer); }
}

void* operator new(std::size_t size) { return allocate(size); }
void* operator new[](std::size_t size) { return allocate(size); }
void* operator new(std::size_t size, const std::nothrow_t&) noexcept { return allocate_nothrow(size); }
void* operator new[](std::size_t size, const std::nothrow_t&) noexcept { return allocate_nothrow(size); }
void operator delete(void* pointer) noexcept { release(pointer); }
void operator delete[](void* pointer) noexcept { release(pointer); }
void operator delete(void* pointer, std::size_t) noexcept { release(pointer); }
void operator delete[](void* pointer, std::size_t) noexcept { release(pointer); }
void operator delete(void* pointer, const std::nothrow_t&) noexcept { release(pointer); }
void operator delete[](void* pointer, const std::nothrow_t&) noexcept { release(pointer); }
