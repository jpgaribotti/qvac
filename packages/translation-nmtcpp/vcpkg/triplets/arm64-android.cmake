# Layer CMAKE_CXX_STANDARD=20 on the repo triplet. FuzzTest's registry pin
# replaces onnxruntime Abseil with 20260526.0, whose compare.h needs C++20;
# SentencePiece's port compiles at the compiler default without this.
include("${CMAKE_CURRENT_LIST_DIR}/../../../vcpkg-overlays/triplets/arm64-android.cmake")
if(DEFINED VCPKG_CMAKE_CONFIGURE_OPTIONS)
  list(APPEND VCPKG_CMAKE_CONFIGURE_OPTIONS -DCMAKE_CXX_STANDARD=20 -DCMAKE_CXX_STANDARD_REQUIRED=ON)
else()
  set(VCPKG_CMAKE_CONFIGURE_OPTIONS -DCMAKE_CXX_STANDARD=20 -DCMAKE_CXX_STANDARD_REQUIRED=ON)
endif()
