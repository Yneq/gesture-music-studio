package com.vance.gesturemusicstudio.service;

import com.vance.gesturemusicstudio.dto.auth.RegisterRequest;
import com.vance.gesturemusicstudio.model.User;

public interface UserService {

    User register(RegisterRequest request);

    User getById(Long id);

    boolean existsByUsername(String username);
}
